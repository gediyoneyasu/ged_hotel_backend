const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const axios = require('axios');
//require('dotenv').config();
// For production on Render
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const defaultLocalOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://localhost:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5000'
];

function normalizeOrigin(origin) {
  const value = String(origin || '').trim();
  if (!value) return '';
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return value.replace(/\/$/, '').toLowerCase();
  }
}

function originsFromEnv() {
  const list = [];
  const add = (value) => {
    const v = normalizeOrigin(value);
    if (v) list.push(v);
  };

  if (process.env.FRONTEND_URL) add(process.env.FRONTEND_URL);

  if (process.env.FRONTEND_URLS) {
    for (const part of String(process.env.FRONTEND_URLS).split(',')) {
      add(part);
    }
  }

  if (process.env.ALLOWED_ORIGINS) {
    for (const part of String(process.env.ALLOWED_ORIGINS).split(',')) {
      add(part);
    }
  }

  // Render/Vercel often exposes this without protocol (example: my-app.vercel.app)
  if (process.env.VERCEL_URL) add(`https://${String(process.env.VERCEL_URL).replace(/^https?:\/\//, '')}`);

  return [...new Set(list)];
}

const corsAllowedList = originsFromEnv();
const corsAllowed = (corsAllowedList.length ? corsAllowedList : defaultLocalOrigins.map(normalizeOrigin));

/** Any *.vercel.app preview/production URL (HTTPS). */
function isVercelAppOrigin(origin) {
  return /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(String(origin).trim());
}

/** Local network frontend origins for development (same Wi-Fi/LAN). */
function isPrivateNetworkOrigin(origin) {
  const value = String(origin || '').trim().toLowerCase();
  return /^https?:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(value);
}

// Middleware — set FRONTEND_URL or ALLOWED_ORIGINS on Render for custom domains.
// Vercel *.vercel.app is allowed automatically so previews work without extra env.
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const normalizedOrigin = normalizeOrigin(origin);
    if (corsAllowed.includes(normalizedOrigin)) return callback(null, true);
    if (isVercelAppOrigin(normalizedOrigin)) return callback(null, true);
    if (process.env.NODE_ENV !== 'production' && isPrivateNetworkOrigin(normalizedOrigin)) {
      return callback(null, true);
    }
    console.warn('⛔ Blocked by CORS:', normalizedOrigin, 'Allowed:', corsAllowed);
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ==================== MODELS (SCHEMAS) ====================

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Booking Schema
const bookingSchema = new mongoose.Schema({
  bookingReference: { type: String, required: true, unique: true },
  roomType: { type: String, required: true },
  price: { type: Number, required: true },
  checkIn: { type: String, required: true },
  checkOut: { type: String, required: true },
  guests: { type: Number, required: true },
  fullName: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  nationality: { type: String, default: '' },
  specialRequest: { type: String, default: '' },
  paymentMethod: { type: String, default: 'chapa' },
  totalAmount: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'confirmed', 'cancelled', 'completed'],
    default: 'pending' 
  },
  paymentReference: { type: String, default: '' },
  paymentStatus: { 
    type: String, 
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  bookingDate: { type: Date, default: Date.now },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

// Room Schema
const roomSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, required: true },
  image: { type: String, required: true },
  features: [{ type: String }],
  capacity: { type: Number, default: 2 },
  available: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Admin Schema
const adminSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'admin' },
  createdAt: { type: Date, default: Date.now }
});

// Contact Schema
const contactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, default: '' },
  subject: { type: String, default: '' },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Create Models
const User = mongoose.model('User', userSchema);
const Booking = mongoose.model('Booking', bookingSchema);
const Room = mongoose.model('Room', roomSchema);
const Admin = mongoose.model('Admin', adminSchema);
const Contact = mongoose.model('Contact', contactSchema);

// ==================== INITIALIZE DEFAULT ADMIN ====================
const initializeAdmin = async () => {
  try {
    const adminExists = await Admin.findOne({ email: 'admin@gedhotel.com' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await Admin.create({
        name: 'Super Admin',
        email: 'admin@gedhotel.com',
        password: hashedPassword
      });
      console.log('✅ Default admin created');
      console.log('   Email: admin@gedhotel.com');
      console.log('   Password: admin123');
    }
  } catch (error) {
    console.log('Admin initialization error:', error.message);
  }
};

// ==================== INITIALIZE DEFAULT ROOMS ====================
const initializeRooms = async () => {
  try {
    const roomCount = await Room.countDocuments();
    if (roomCount === 0) {
      const defaultRooms = [
        {
          name: "Junior Suite",
          price: 150,
          category: "Popular",
          image: "https://images.unsplash.com/photo-1566665797739-1674de7a421a?w=500",
          features: ["Free High-speed Internet", "Television with Cable", "Daily cleaning", "24/7 Room Service"],
          capacity: 2
        },
        {
          name: "Deluxe Room",
          price: 250,
          category: "Luxury",
          image: "https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=500",
          features: ["King Size Bed", "City View", "Mini Bar", "Premium Toiletries"],
          capacity: 2
        },
        {
          name: "Presidential Suite",
          price: 450,
          category: "Premium",
          image: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=500",
          features: ["Private Balcony", "Jacuzzi", "Butler Service", "Complimentary Breakfast"],
          capacity: 4
        },
        {
          name: "Executive Room",
          price: 320,
          category: "Business",
          image: "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=500",
          features: ["Work Desk", "Conference Access", "Express Laundry", "Airport Shuttle"],
          capacity: 2
        },
        {
          name: "Family Suite",
          price: 380,
          category: "Family",
          image: "https://images.unsplash.com/photo-1590490360182-c33d57733427?w=500",
          features: ["Two Bedrooms", "Kids Play Area", "Kitchenette", "Extra Bed Available"],
          capacity: 4
        },
        {
          name: "Honeymoon Suite",
          price: 520,
          category: "Romantic",
          image: "https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?w=500",
          features: ["Ocean View", "Private Pool", "Champagne Service", "Candlelight Dinner"],
          capacity: 2
        },
        {
          name: "Royal Suite",
          price: 850,
          category: "Ultra Luxury",
          image: "https://images.unsplash.com/photo-1631049035182-249067d7618e?w=500",
          features: ["Personal Butler", "Panoramic View", "Private Elevator", "Limousine Service"],
          capacity: 4
        },
        {
          name: "Garden Villa",
          price: 680,
          category: "Nature",
          image: "https://images.unsplash.com/photo-1561501900-3701fa6a0864?w=500",
          features: ["Private Garden", "Outdoor Shower", "Organic Breakfast", "Yoga Sessions"],
          capacity: 6
        }
      ];
      
      await Room.insertMany(defaultRooms);
      console.log('✅ Default rooms created');
    }
  } catch (error) {
    console.log('Rooms initialization error:', error.message);
  }
};

// ==================== API ROUTES ====================

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Ged Hotel API is running!', version: '1.0.0' });
});

app.get('/api/health', (req, res) => {
  res.json({ message: 'Ged Hotel API is running!', version: '1.0.0' });
});

// ==================== USER AUTH ROUTES ====================

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashedPassword });
    
    res.json({ 
      success: true, 
      message: 'User created successfully',
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    res.json({
      success: true,
      message: 'Login successful',
      token: 'user-token-' + user._id,
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get user profile
app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    
    const userId = token.split('-').pop();
    const user = await User.findById(userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== BOOKING ROUTES ====================

// Create new booking
app.post('/api/bookings', async (req, res) => {
  try {
    console.log('📝 Received booking:', JSON.stringify(req.body, null, 2));
    
    const booking = new Booking(req.body);
    await booking.save();
    
    console.log('✅ Booking saved:', booking.bookingReference);
    
    res.json({
      success: true,
      message: 'Booking created successfully',
      data: booking
    });
  } catch (error) {
    console.error('❌ Booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get user bookings by email
app.get('/api/bookings/my-bookings', async (req, res) => {
  try {
    const { email } = req.query;
    const bookings = await Booking.find({ email }).sort({ bookingDate: -1 });
    res.json({
      success: true,
      data: bookings
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// User bookings (Bearer user-token-<id> — same shape as /api/auth/me)
app.get('/api/bookings/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    const userId = token.split('-').pop();
    const user = await User.findById(userId).select('email');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const bookings = await Booking.find({ email: user.email }).sort({ bookingDate: -1 });
    res.json({ success: true, data: bookings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Single booking by reference (must belong to logged-in user)
app.get('/api/bookings/reference/:ref', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    const userId = token.split('-').pop();
    const user = await User.findById(userId).select('email');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const booking = await Booking.findOne({ bookingReference: req.params.ref });
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    const owner =
      (booking.userId && String(booking.userId) === String(userId)) ||
      String(booking.email || '').toLowerCase() === String(user.email || '').toLowerCase();
    if (!owner) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    res.json({ success: true, data: booking });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== ADMIN AUTH ROUTES ====================

// Admin login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const admin = await Admin.findOne({ email });
    
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    const isMatch = await bcrypt.compare(password, admin.password);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    res.json({
      success: true,
      message: 'Login successful',
      token: 'admin-token-' + admin._id,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ==================== ADMIN BOOKING ROUTES ====================

// Get all bookings
app.get('/api/admin/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find().sort({ bookingDate: -1 });
    res.json({
      success: true,
      data: bookings
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Update booking status
app.put('/api/admin/bookings/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Booking status updated',
      data: booking
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Delete booking
app.delete('/api/admin/bookings/:id', async (req, res) => {
  try {
    const booking = await Booking.findByIdAndDelete(req.params.id);
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Booking deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get dashboard stats
app.get('/api/admin/stats', async (req, res) => {
  try {
    const totalBookings = await Booking.countDocuments();
    const confirmedBookings = await Booking.countDocuments({ status: 'confirmed' });
    const pendingBookings = await Booking.countDocuments({ status: 'pending' });
    const cancelledBookings = await Booking.countDocuments({ status: 'cancelled' });
    const totalUsers = await User.countDocuments();
    
    const totalRevenueResult = await Booking.aggregate([
      { $match: { status: 'confirmed' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    const recentBookings = await Booking.find()
      .sort({ bookingDate: -1 })
      .limit(5);

    const totalContacts = await Contact.countDocuments();
    const recentContacts = await Contact.find()
      .sort({ createdAt: -1 })
      .limit(5);
    
    res.json({
      success: true,
      data: {
        totalBookings,
        confirmedBookings,
        pendingBookings,
        cancelledBookings,
        totalRevenue: totalRevenueResult[0]?.total || 0,
        totalContacts,
        totalUsers,
        recentBookings,
        recentContacts
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ==================== CONTACT ROUTES ====================

// Save contact message
app.post('/api/contact', async (req, res) => {
  try {
    console.log('📧 New contact message from:', req.body.email);
    const contact = new Contact(req.body);
    await contact.save();
    res.json({
      success: true,
      message: 'Message sent successfully',
      data: contact
    });
  } catch (error) {
    console.error('Contact error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get all contact messages (Admin)
app.get('/api/admin/contacts', async (req, res) => {
  try {
    const contacts = await Contact.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      data: contacts
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Delete contact message (Admin)
app.delete('/api/admin/contacts/:id', async (req, res) => {
  try {
    await Contact.findByIdAndDelete(req.params.id);
    res.json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ==================== ADMIN USER ROUTES ====================

// Get all users (Admin)
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Delete user (Admin)
app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get user statistics
app.get('/api/admin/users/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);
    
    const newThisMonth = await User.countDocuments({
      createdAt: { $gte: currentMonth }
    });
    
    res.json({
      success: true,
      data: {
        totalUsers,
        newThisMonth
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ==================== CHAPA PAYMENT INTEGRATION ====================

// Chapa configuration
const CHAPA_SECRET_KEY = (process.env.CHAPA_SECRET_KEY || '').trim();
const CHAPA_BASE_URL = 'https://api.chapa.co/v1';

// Initialize payment
app.post('/api/payment/initialize', async (req, res) => {
  try {
    const {
      amount,
      email,
      fullName,
      phone,
      bookingReference,
      roomType,
      checkIn,
      checkOut,
      guests
    } = req.body;

    if (!bookingReference) {
      return res.status(400).json({ success: false, message: 'Missing booking reference' });
    }

    if (!CHAPA_SECRET_KEY || CHAPA_SECRET_KEY.includes('xxxxxxxxx')) {
      return res.status(503).json({
        success: false,
        message: 'Chapa is not configured. Add CHAPA_SECRET_KEY to Backend/.env'
      });
    }

    const clientOrigin = (req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const tx_ref = 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    const nameParts = String(fullName || 'Guest').trim().split(/\s+/);
    const first_name = nameParts[0] || 'Guest';
    const last_name = nameParts.slice(1).join(' ') || 'Customer';

    const digits = String(phone || '').replace(/\D/g, '');
    const phone_number = digits.length >= 9 ? String(phone).replace(/\s/g, '') : '0912345678';

    const amountStr = String(Math.max(1, Math.round(Number(amount) || 0)));

    const paymentData = {
      amount: amountStr,
      currency: 'ETB',
      email: String(email || 'guest@gedhotel.com').trim(),
      first_name,
      last_name,
      phone_number,
      tx_ref,
      callback_url: `${clientOrigin}/booking?chapa_return=1&tx_ref=${encodeURIComponent(tx_ref)}&booking_ref=${encodeURIComponent(bookingReference)}`,
      return_url: `${clientOrigin}/booking?chapa_return=1&tx_ref=${encodeURIComponent(tx_ref)}&booking_ref=${encodeURIComponent(bookingReference)}`,
      customization: {
        title: 'Ged Hotel',
        description: `${roomType || 'Room'}`
      }
    };

    const response = await axios.post(`${CHAPA_BASE_URL}/transaction/initialize`, paymentData, {
      headers: {
        Authorization: `Bearer ${CHAPA_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data.status === 'success' && response.data.data?.checkout_url) {
      await Booking.findOneAndUpdate(
        { bookingReference: bookingReference },
        { paymentReference: tx_ref, paymentStatus: 'pending' }
      );

      return res.json({ success: true, checkout_url: response.data.data.checkout_url, tx_ref });
    }

    throw new Error('Payment initialization failed');
  } catch (error) {
    console.error('Payment error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Verify payment
app.get('/api/payment/verify/:tx_ref', async (req, res) => {
  try {
    const { tx_ref } = req.params;
    
    console.log('🔍 Verifying payment for tx_ref:', tx_ref);
    
    const response = await axios.get(
      `${CHAPA_BASE_URL}/transaction/verify/${tx_ref}`,
      {
        headers: { 'Authorization': `Bearer ${CHAPA_SECRET_KEY}` }
      }
    );

    console.log('📡 Chapa verification response:', response.data);

    const transactionStatus = String(response.data?.data?.status || response.data?.data?.transaction_status || '');
    const verified = response.data.status === 'success' && /success|successful|completed/i.test(transactionStatus);

    if (verified) {
      const updatedBooking = await Booking.findOneAndUpdate(
        { paymentReference: tx_ref },
        { paymentStatus: 'completed', status: 'confirmed' },
        { new: true }
      );
      
      console.log('✅ Booking confirmed:', updatedBooking?.bookingReference);

      res.json({ success: true, message: 'Payment verified successfully', booking: updatedBooking });
    } else {
      res.json({ success: false, message: 'Payment verification failed' });
    }
  } catch (error) {
    console.error('❌ Verification error:', error.message);
    res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
});

// Manual verification by booking reference (alias: verify-by-booking for frontend)
async function verifyPaymentByBookingRef(req, res) {
  try {
    const { bookingRef } = req.params;

    const booking = await Booking.findOne({ bookingReference: bookingRef });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.paymentStatus === 'completed') {
      return res.json({ success: true, message: 'Payment already verified', booking });
    }

    if (booking.paymentReference) {
      const response = await axios.get(
        `${CHAPA_BASE_URL}/transaction/verify/${booking.paymentReference}`,
        {
          headers: { Authorization: `Bearer ${CHAPA_SECRET_KEY}` }
        }
      );

      const transactionStatus = String(response.data?.data?.status || response.data?.data?.transaction_status || '');
      const verified = response.data.status === 'success' && /success|successful|completed/i.test(transactionStatus);

      if (verified) {
        const updatedBooking = await Booking.findByIdAndUpdate(booking._id, {
          paymentStatus: 'completed',
          status: 'confirmed'
        }, { new: true });
        return res.json({ success: true, message: 'Payment verified successfully', booking: updatedBooking });
      }
    }

    res.json({ success: false, message: 'Payment not completed yet' });
  } catch (error) {
    console.error('Manual verification error:', error);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
}

app.get('/api/payment/verify-manual/:bookingRef', verifyPaymentByBookingRef);
app.get('/api/payment/verify-by-booking/:bookingRef', verifyPaymentByBookingRef);

// TEST MODE - Force confirm booking (for testing without real payment)
app.post('/api/payment/force-confirm/:bookingRef', async (req, res) => {
  try {
    const { bookingRef } = req.params;
    const booking = await Booking.findOneAndUpdate(
      { bookingReference: bookingRef },
      { paymentStatus: 'completed', status: 'confirmed' },
      { new: true }
    );
    if (booking) {
      res.json({ success: true, message: 'Booking confirmed for testing', booking });
    } else {
      res.json({ success: false, message: 'Booking not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Webhook for Chapa
app.post('/api/payment/webhook', async (req, res) => {
  try {
    const event = req.body;
    if (event.status === 'success') {
      await Booking.findOneAndUpdate(
        { paymentReference: event.tx_ref },
        { paymentStatus: 'completed', status: 'confirmed' }
      );
      console.log('✅ Webhook: Payment confirmed for', event.tx_ref);
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ received: false });
  }
});

// ==================== ROOM ROUTES ====================

// Get all rooms
app.get('/api/rooms', async (req, res) => {
  try {
    const rooms = await Room.find();
    res.json(rooms);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get single room
app.get('/api/rooms/:id', async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }
    res.json(room);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Create room (Admin)
app.post('/api/rooms', async (req, res) => {
  try {
    const room = new Room(req.body);
    await room.save();
    res.status(201).json(room);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Update room (Admin)
app.put('/api/rooms/:id', async (req, res) => {
  try {
    const room = await Room.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }
    res.json(room);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Delete room (Admin)
app.delete('/api/rooms/:id', async (req, res) => {
  try {
    const room = await Room.findByIdAndDelete(req.params.id);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }
    res.json({
      success: true,
      message: 'Room deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// SIMPLE CONFIRM BOOKING ROUTE - This will work
app.post('/api/confirm-booking/:bookingRef', async (req, res) => {
  try {
    const booking = await Booking.findOneAndUpdate(
      { bookingReference: req.params.bookingRef },
      { status: 'confirmed', paymentStatus: 'completed' },
      { new: true }
    );
    res.json({ success: true, booking });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ==================== DATABASE CONNECTION ====================

const mongoUri = process.env.MONGO_URI;
if (process.env.NODE_ENV === 'production' && !mongoUri) {
  console.error('❌ MONGO_URI is required in production');
  process.exit(1);
}

mongoose
  .connect(mongoUri || 'mongodb://127.0.0.1:27017/ged_hotel')
  .then(async () => {
    console.log('✅ MongoDB Connected');
    await initializeAdmin();
    await initializeRooms();
  })
  .catch((err) => console.log('❌ MongoDB Error:', err.message));

// ==================== FRONTEND (SPA) OR DEV REDIRECT ====================

const clientDist = path.join(__dirname, '..', 'Ged_hotel', 'dist');
const indexHtml = path.join(clientDist, 'index.html');
const frontendDevOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';

if (fs.existsSync(indexHtml)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    if (req.path.startsWith('/assets') || path.extname(req.path)) return next();
    res.sendFile(path.resolve(indexHtml));
  });
} else {
  app.get('/', (req, res) => {
    res.json({ message: 'Ged Hotel API is running!', version: '1.0.0' });
  });
  app.use('/admin', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.redirect(302, `${frontendDevOrigin}${req.originalUrl}`);
  });
}

// ==================== START SERVER ====================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  const host = process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`;
  console.log(`\n🚀 API server listening on port ${PORT} (${host})`);
  if (fs.existsSync(indexHtml)) {
    console.log(`📋 Serving built frontend from Ged_hotel/dist`);
    console.log(`📋 Admin UI (dev): http://127.0.0.1:5173/admin/login`);
  } else {
    console.log(`📋 Admin UI: ${frontendDevOrigin}/admin/login`);
    console.log(`📋 Frontend: ${frontendDevOrigin}/`);
    console.log(`   Tip: Run "npm run dev" in Ged_hotel, or deploy the SPA on Vercel with VITE_API_URL pointing here.\n`);
  }
});