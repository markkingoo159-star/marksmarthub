require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();

/* =========================
   MIDDLEWARE
========================= */
app.use(cors());
app.use(express.json());

/* =========================
   MONGODB CONNECTION
========================= */
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("MongoDB Error:", err));

/* =========================
   USER MODEL
========================= */
const UserSchema = new mongoose.Schema({
  username: String,
  password: String,
  balance: { type: Number, default: 1000 }
});

const User = mongoose.model("User", UserSchema);

/* =========================
   ROUTES
========================= */
app.get("/", (req, res) => {
  res.send("API is running...");
});

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    const exists = await User.findOne({ username });
    if (exists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const user = new User({ username, password });
    await user.save();

    res.json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ message: "Register error" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username, password });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    res.json({ message: "Login success", user });
  } catch (err) {
    res.status(500).json({ message: "Login error" });
  }
});

app.get("/balance/:username", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });

    res.json({ balance: user ? user.balance : 0 });
  } catch (err) {
    res.status(500).json({ message: "Balance error" });
  }
});

/* =========================
   START SERVER
========================= */
app.listen(process.env.PORT || 5000, "0.0.0.0", () => {
  console.log("Server running");
});
