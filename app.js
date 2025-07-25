// jshint esversion:6
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const bodyParser = require("body-parser");
const User = require("./models/user");
const Message = require("./models/Message");

dotenv.config();

const app = express();
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const PORT = process.env.PORT || 3000;

// ✅ MongoDB Connect
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("Mongo Error:", err));

// ✅ Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// ✅ Routes FIRST — Serve HTML files
app.get("/", (req, res) => {
  res.sendFile("welcome.html", { root: path.join(__dirname, "public") });
});
app.get("/login", (req, res) => {
  res.sendFile("login.html", { root: path.join(__dirname, "public") });
});
app.get("/signup", (req, res) => {
  res.sendFile("signup.html", { root: path.join(__dirname, "public") });
});
app.get("/chat", (req, res) => {
  res.sendFile("index.html", { root: path.join(__dirname, "public") }); // 🔁 Rename from index.html to chat.html
});

// ✅ Serve Static Files (AFTER routing to avoid overriding `/`)
app.use(express.static(path.join(__dirname, "public")));

app.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword });
    await user.save();

    res.status(201).json({ message: "Signup successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid password" });

    const token = jwt.sign({ id: user._id, name: user.name }, process.env.JWT_SECRET, { expiresIn: "1h" });

    res.json({
      message: "Login successful",
      token,
      user: {
        name: user.name,
        email: user.email
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Chat Message API – for loading chat history
app.get("/api/messages", async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: 1 }).limit(20);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Failed to load messages" });
  }
});

// ✅ SOCKET.IO Logic
const users = {};
io.on("connection", (socket) => {
  socket.on("new-user-joined", async (name) => {
    users[socket.id] = name;
    console.log(`${name} connected`);

    try {
      const pastMessages = await Message.find().sort({ timestamp: 1 }).lean();
      socket.emit("chat-history", pastMessages);
    } catch (err) {
      console.error("Error fetching messages:", err);
    }

    socket.emit("self-joined", {
      name,
      activeUsers: Object.keys(users).length,
    });

    socket.broadcast.emit("user-joined", {
      name,
      activeUsers: Object.keys(users).length,
    });
  });

  socket.on("msg-sent", async (message) => {
    const sender = users[socket.id];
    if (!sender) return;

    const newMsg = new Message({ sender, text: message, timestamp: new Date() });
    await newMsg.save();

    socket.broadcast.emit("msg-receive", { name: sender, message });
  });

  socket.on("disconnect", () => {
    if (!users[socket.id]) return;
    socket.broadcast.emit("who-disconnected", users[socket.id]);
    delete users[socket.id];
    socket.broadcast.emit("user-disconnected", Object.keys(users).length);
  });
});

// ✅ Start Server
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
