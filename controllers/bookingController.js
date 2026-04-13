const Booking = require('../models/Booking');

// @desc    Create new booking
// @route   POST /api/bookings
// @access  Public
const createBooking = async (req, res) => {
  try {
    console.log("Received booking data:", req.body);
    
    const booking = await Booking.create(req.body);
    
    console.log("Booking created:", booking);
    
    res.status(201).json({
      success: true,
      message: "Booking created successfully",
      data: booking
    });
  } catch (error) {
    console.error("Booking error:", error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Get user bookings by email
// @route   GET /api/bookings/my-bookings
// @access  Public
const getUserBookings = async (req, res) => {
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
};

// @desc    Get all bookings (admin)
// @route   GET /api/bookings/admin/all
// @access  Private/Admin
const getAllBookings = async (req, res) => {
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
};

module.exports = {
  createBooking,
  getUserBookings,
  getAllBookings
};