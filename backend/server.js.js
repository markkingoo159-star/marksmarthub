require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const axios = require("axios");
const bcrypt = require("bcryptjs");
const WebSocket = require("ws");

const app = express();

app.use(cors());
app.use(express.json());

/* ================= DATABASE ================= */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("MongoDB Error:", err));

/* ================= MODELS ================= */
const User = mongoose.model(
  "User",
  new mongoose.Schema({
    username: String,
    password: String,
    balance: { type: Number, default: 1000 },
    referralCode: String,
    referredBy: String,
    referralEarnings: { type: Number, default: 0 },
    derivToken: String
  })
);

const Deposit = mongoose.model(
  "Deposit",
  new mongoose.Schema({
    username: String,
    amount: Number,
    phone: String,
    status: { type: String, default: "pending" },
    reference: String,
    createdAt: { type: Date, default: Date.now }
  })
);

const Withdrawal = mongoose.model(
  "Withdrawal",
  new mongoose.Schema({
    username: String,
    amount: Number,
    phone: String,
    status: { type: String, default: "pending" },
    createdAt: { type: Date, default: Date.now }
  })
);

/* ================= ADMIN CHECK ================= */
function checkAdmin(req, res, next) {
  const adminPassword = req.headers["x-admin-password"];

  if (!adminPassword || adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ message: "Unauthorized admin access" });
  }

  next();
}

/* ================= DERIV HELPERS ================= */
function getMainDerivToken() {
  return process.env.DERIV_API_TOKEN || process.env.DERIV_TOKEN;
}

function getDerivBalance(token = getMainDerivToken()) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `wss://ws.derivws.com/websockets/v3?app_id=${process.env.DERIV_APP_ID}`
    );

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          authorize: token
        })
      );
    });

    ws.on("message", (msg) => {
      const data = JSON.parse(msg.toString());

      if (data.error) {
        ws.close();
        return reject(data.error.message);
      }

      if (data.msg_type === "authorize") {
        ws.send(JSON.stringify({ balance: 1 }));
      }

      if (data.msg_type === "balance") {
        ws.close();
        resolve({
          balance: data.balance.balance,
          currency: data.balance.currency,
          loginid: data.balance.loginid
        });
      }
    });

    ws.on("error", (err) => {
      reject(err.message);
    });

    ws.on("close", () => {});
  });
}

function placeDerivTrade({
  amount,
  symbol = "R_50",
  contract = "CALL",
  duration = 5,
  durationUnit = "t",
  token = getMainDerivToken()
}) {
  return new Promise((resolve, reject) => {
    if (!token) {
      return reject("Missing Deriv token");
    }

    if (!amount || Number(amount) <= 0) {
      return reject("Invalid trade amount");
    }

    const ws = new WebSocket(
      `wss://ws.derivws.com/websockets/v3?app_id=${process.env.DERIV_APP_ID}`
    );

    let isResolved = false;

    function finishError(error) {
      if (!isResolved) {
        isResolved = true;
        ws.close();
        reject(error);
      }
    }

    function finishSuccess(result) {
      if (!isResolved) {
        isResolved = true;
        ws.close();
        resolve(result);
      }
    }

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          authorize: token
        })
      );
    });

    ws.on("message", (msg) => {
      const data = JSON.parse(msg.toString());

      if (data.error) {
        return finishError(data.error.message);
      }

      if (data.msg_type === "authorize") {
        ws.send(
          JSON.stringify({
            proposal: 1,
            amount: Number(amount),
            basis: "stake",
            contract_type: contract,
            currency: "USD",
            duration: Number(duration),
            duration_unit: durationUnit,
            symbol: symbol
          })
        );
      }

      if (data.msg_type === "proposal") {
        ws.send(
          JSON.stringify({
            buy: data.proposal.id,
            price: Number(amount)
          })
        );
      }

      if (data.msg_type === "buy") {
        finishSuccess(data.buy);
      }
    });

    ws.on("error", (err) => {
      finishError(err.message);
    });
  });
}

/* ================= ROUTES ================= */
app.get("/", (req, res) => {
  res.send("MarkSmartHub API is running...");
});

/* ================= DERIV ================= */
app.get("/deriv/balance", async (req, res) => {
  try {
    const data = await getDerivBalance();

    res.json({
      message: "Deriv balance fetched",
      data
    });
  } catch (err) {
    res.status(500).json({
      message: "Deriv error",
      error: err
    });
  }
});

app.post("/deriv/trade", async (req, res) => {
  try {
    const {
      amount,
      symbol = "R_50",
      contract = "CALL",
      duration = 5,
      durationUnit = "t"
    } = req.body;

    const trade = await placeDerivTrade({
      amount,
      symbol,
      contract,
      duration,
      durationUnit
    });

    res.json({
      message: "Trade placed successfully",
      trade
    });
  } catch (err) {
    res.status(500).json({
      message: "Trade failed",
      error: err
    });
  }
});

/* ================= USER DERIV TOKEN ================= */
app.post("/user/deriv-token", async (req, res) => {
  try {
    const { username, derivToken } = req.body;

    if (!username || !derivToken) {
      return res.status(400).json({
        message: "Username and Deriv token required"
      });
    }

    const user = await User.findOneAndUpdate(
      { username },
      { derivToken },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Deriv token saved successfully"
    });
  } catch (err) {
    res.status(500).json({
      message: "Save token error",
      error: err.message
    });
  }
});

app.get("/user/:username/deriv-balance", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });

    if (!user || !user.derivToken) {
      return res.status(400).json({
        message: "User Deriv token not found"
      });
    }

    const data = await getDerivBalance(user.derivToken);

    res.json({
      message: "User Deriv balance fetched",
      data
    });
  } catch (err) {
    res.status(500).json({
      message: "User Deriv balance error",
      error: err
    });
  }
});

app.post("/user/:username/deriv-trade", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });

    if (!user || !user.derivToken) {
      return res.status(400).json({
        message: "User Deriv token not found"
      });
    }

    const {
      amount,
      symbol = "R_50",
      contract = "CALL",
      duration = 5,
      durationUnit = "t"
    } = req.body;

    const trade = await placeDerivTrade({
      amount,
      symbol,
      contract,
      duration,
      durationUnit,
      token: user.derivToken
    });

    res.json({
      message: "User trade placed successfully",
      trade
    });
  } catch (err) {
    res.status(500).json({
      message: "User trade failed",
      error: err
    });
  }
});

/* ================= AUTH ================= */
app.post("/register", async (req, res) => {
  try {
    const { username, password, referralCode } = req.body;

    const exists = await User.findOne({ username });

    if (exists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const myReferralCode = username + Math.floor(Math.random() * 9999);

    const user = new User({
      username,
      password: hashedPassword,
      referralCode: myReferralCode,
      referredBy: referralCode || ""
    });

    await user.save();

    if (referralCode) {
      await User.findOneAndUpdate(
        { referralCode },
        {
          $inc: {
            referralEarnings: 50,
            balance: 50
          }
        }
      );
    }

    res.json({
      message: "User registered successfully",
      referralCode: myReferralCode
    });
  } catch (err) {
    res.status(500).json({
      message: "Register error",
      error: err.message
    });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    res.json({
      message: "Login success",
      user
    });
  } catch (err) {
    res.status(500).json({
      message: "Login error",
      error: err.message
    });
  }
});

/* ================= PROFILE ================= */
app.get("/profile/:username", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  res.json(user || {});
});

app.get("/balance/:username", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });

  res.json({
    balance: user ? user.balance : 0
  });
});

/* ================= DEPOSIT ================= */
app.post("/deposit", async (req, res) => {
  try {
    const { username, amount, phone } = req.body;

    const deposit = new Deposit({
      username,
      amount: Number(amount),
      phone
    });

    await deposit.save();

    res.json({
      message: "Deposit request submitted",
      deposit
    });
  } catch (err) {
    res.status(500).json({
      message: "Deposit error",
      error: err.message
    });
  }
});

app.get("/deposits/:username", async (req, res) => {
  const deposits = await Deposit.find({
    username: req.params.username
  }).sort({ createdAt: -1 });

  res.json(deposits);
});

/* ================= WITHDRAW ================= */
app.post("/withdraw", async (req, res) => {
  try {
    const { username, amount, phone } = req.body;

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.balance < Number(amount)) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    await User.findOneAndUpdate(
      { username },
      {
        $inc: {
          balance: -Number(amount)
        }
      }
    );

    const withdrawal = new Withdrawal({
      username,
      amount: Number(amount),
      phone
    });

    await withdrawal.save();

    res.json({
      message: "Withdrawal request submitted",
      withdrawal
    });
  } catch (err) {
    res.status(500).json({
      message: "Withdraw error",
      error: err.message
    });
  }
});

app.get("/withdrawals/:username", async (req, res) => {
  const withdrawals = await Withdrawal.find({
    username: req.params.username
  }).sort({ createdAt: -1 });

  res.json(withdrawals);
});

/* ================= PAYSTACK ================= */
app.post("/paystack/initiate", async (req, res) => {
  try {
    const { email, amount, username } = req.body;

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: Number(amount) * 100,
        metadata: {
          username,
          amount
        },
        callback_url:
          process.env.PAYSTACK_CALLBACK_URL ||
          "https://marksmarthub-backend.onrender.com/paystack/callback"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const reference = response.data.data.reference;

    await Deposit.create({
      username,
      amount: Number(amount),
      phone: "Paystack",
      reference
    });

    res.json(response.data);
  } catch (err) {
    res.status(500).json({
      message: "Payment error",
      error: err.message
    });
  }
});

app.get("/paystack/callback", async (req, res) => {
  try {
    const reference = req.query.reference;

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
      return res.send("Payment failed");
    }

    const username = payment.metadata.username;
    const amount = Number(payment.metadata.amount);

    await User.findOneAndUpdate(
      { username },
      {
        $inc: {
          balance: amount
        }
      }
    );

    await Deposit.findOneAndUpdate(
      { reference },
      {
        status: "success"
      }
    );

    res.send("Payment successful");
  } catch (err) {
    res.send("Verification error");
  }
});

/* ================= ADMIN ================= */
app.get("/admin/users", checkAdmin, async (req, res) => {
  const users = await User.find();
  res.json(users);
});

app.get("/admin/deposits", checkAdmin, async (req, res) => {
  const deposits = await Deposit.find().sort({ createdAt: -1 });
  res.json(deposits);
});

app.get("/admin/withdrawals", checkAdmin, async (req, res) => {
  const withdrawals = await Withdrawal.find().sort({ createdAt: -1 });
  res.json(withdrawals);
});

app.post("/admin/deposits/:id/approve", checkAdmin, async (req, res) => {
  try {
    const d = await Deposit.findById(req.params.id);

    if (!d || d.status === "success") {
      return res.status(400).json({
        message: "Invalid deposit"
      });
    }

    await User.findOneAndUpdate(
      { username: d.username },
      {
        $inc: {
          balance: d.amount
        }
      }
    );

    d.status = "success";
    await d.save();

    res.json({
      message: "Deposit approved"
    });
  } catch (err) {
    res.status(500).json({
      message: "Approve deposit error",
      error: err.message
    });
  }
});

app.post("/admin/withdrawals/:id/approve", checkAdmin, async (req, res) => {
  try {
    const w = await Withdrawal.findById(req.params.id);

    if (!w) {
      return res.status(404).json({
        message: "Not found"
      });
    }

    w.status = "success";
    await w.save();

    res.json({
      message: "Withdrawal approved"
    });
  } catch (err) {
    res.status(500).json({
      message: "Approve withdrawal error",
      error: err.message
    });
  }
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
