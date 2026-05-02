const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

let users = [];

// Register
app.post("/register", (req, res) => {
  const { username, password } = req.body;
  users.push({ username, password, balance: 1000 });
  res.json({ message: "User registered" });
});

// Login
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  const user = users.find(
    (u) => u.username === username && u.password === password
  );

  if (user) {
    res.json({ message: "Login success", user });
  } else {
    res.status(401).json({ message: "Invalid credentials" });
  }
});

// Balance
app.get("/balance/:username", (req, res) => {
  const user = users.find((u) => u.username === req.params.username);
  res.json({ balance: user ? user.balance : 0 });
});

const PORT = process.env.PORT || 5000;
app.listen(process.env.PORT || 5000, "0.0.0.0", () => {
  console.log("Server running");
});
