const express = require("express");
const router = express.Router();

const {
  createBooking,
  getAllBookings,
  getBookingById,
  deleteBooking,
} = require("../controllers/bookingController");

// CREATE booking
router.post("/", createBooking);

// GET all bookings
router.get("/", getAllBookings);

// GET single booking
router.get("/:id", getBookingById);

// DELETE booking
router.delete("/:id", deleteBooking);

module.exports = router;