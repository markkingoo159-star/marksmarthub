require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("MongoDB Error:", err));

const UserSchema = new mongoose.Schema({
  username: String,
  password: String,
  balance: { type: Number, default: 1000 }
});

const User = mongoose.model("User", UserSchema);

const DepositSchema = new mongoose.Schema({
  username: String,
  amount: Number,
  phone: String,
  status: { type: String, default: "pending" },
  reference: String,
  createdAt: { type: Date, default: Date.now }
});

const Deposit = mongoose.model("Deposit", DepositSchema);

app.get("/", (req, res) => {
  res.send("MarkSmartHub API is running...");
});

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ message: "User already exists" });

    const user = new User({ username, password });
    await user.save();

    res.json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ message: "Register error", error: err.message });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username, password });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    res.json({ message: "Login success", user });
  } catch (err) {
    res.status(500).json({ message: "Login error", error: err.message });
  }
});

app.get("/balance/:username", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    res.json({ balance: user ? user.balance : 0 });
  } catch (err) {
    res.status(500).json({ message: "Balance error", error: err.message });
  }
});

app.post("/deposit", async (req, res) => {
  try {
    const { username, amount, phone } = req.body;

    if (!username || !amount || !phone) {
      return res.status(400).json({ message: "Username, amount, and phone are required" });
    }

    const deposit = new Deposit({ username, amount, phone });
    await deposit.save();

    res.json({ message: "Deposit request submitted successfully", deposit });
  } catch (err) {
    res.status(500).json({ message: "Deposit error", error: err.message });
  }
});

app.get("/deposits/:username", async (req, res) => {
  try {
    const deposits = await Deposit.find({ username: req.params.username }).sort({ createdAt: -1 });
    res.json(deposits);
  } catch (err) {
    res.status(500).json({ message: "Deposits fetch error", error: err.message });
  }
});

app.post("/paystack/initiate", async (req, res) => {
  try {
    const { email, amount, username } = req.body;

    if (!email || !amount || !username) {
      return res.status(400).json({ message: "Email, amount, and username are required" });
    }

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: Number(amount) * 100,
        metadata: { username, amount },
        callback_url: "https://marksmarthub-backend.onrender.com/paystack/callback"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const reference = response.data.data.reference;

    await Deposit.create({
      username,
      amount: Number(amount),
      phone: "Paystack",
      reference,
      status: "pending"
    });

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      message: "Payment init error",
      error: error.response?.data || error.message
    });
  }
});

app.get("/paystack/callback", async (req, res) => {
  try {
    const reference = req.query.reference;

    if (!reference) return res.send("Missing payment reference");

    const verify = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const payment = verify.data.data;

    if (payment.status !== "success") {
      return res.send("Payment not successful");
    }

    const username = payment.metadata.username;
    const amount = Number(payment.metadata.amount);

    const existingDeposit = await Deposit.findOne({ reference });

    if (existingDeposit && existingDeposit.status === "success") {
      return res.send("Payment already credited. Return to MarkSmartHub.");
    }

    await User.findOneAndUpdate(
      { username },
      { $inc: { balance: amount } }
    );

    await Deposit.findOneAndUpdate(
      { reference },
      { status: "success" }
    );

    res.send("Payment verified and balance credited. Return to MarkSmartHub.");
  } catch (err) {
    res.send("Payment verification error: " + err.message);
  }
});

/* ADMIN ROUTES */
app.get("/admin/users", async (req, res) => {
  try {
    const users = await User.find().sort({ username: 1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Users fetch error", error: err.message });
  }
});

app.get("/admin/deposits", async (req, res) => {
  try {
    const deposits = await Deposit.find().sort({ createdAt: -1 });
    res.json(deposits);
  } catch (err) {
    res.status(500).json({ message: "Deposits fetch error", error: err.message });
  }
});

app.listen(process.env.PORT || 5000, "0.0.0.0", () => {
  console.log("Server running");
});
