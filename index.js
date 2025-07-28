require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB URI Setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.y7n1te0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// JWT Middleware
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send({ message: "Unauthorized. Token missing." });

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send({ message: "Forbidden. Invalid token." });
    req.decoded = decoded;
    next();
  });
}

// Admin Role Middleware
function verifyAdmin(req, res, next) {
  const user = req.decoded;
  if (user.role !== "admin") {
    return res.status(403).send({ message: "Forbidden. Admins only." });
  }
  next();
}

// Main async function
async function run() {
  try {
    const db = client.db("BloodDonationDB");

    const bloodCollection = db.collection("blood");
    const requestCollection = db.collection("requests");
    const usersCollection = db.collection("users");

    console.log("✅ Connected to MongoDB");

    app.get("/", (req, res) => {
      res.send("🩸 Blood Donation Server is Running!");
    });

   // Server-side route for donor search
   app.get("/users", async (req, res) => {
  try {
    const { bloodGroup, district, upazila } = req.query;

    const query = { status: "active" }; // শুধু active ডোনার

    if (bloodGroup) query.blood = bloodGroup;
    if (district) query.district = district;
    if (upazila) query.upazila = upazila;

    const users = await usersCollection.find(query).toArray();

    res.send(users);
  } catch (error) {
    console.error("Error searching donors:", error);
    res.status(500).send({ message: "Server error during donor search" });
  }
});


    // ✅ Existing Routes Below:
    app.post("/jwt", (req, res) => {
      const user = req.body;
      if (!user?.email || !user?.role) {
        return res.status(400).send({ message: "Email and role required." });
      }
      const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "7d" });
      res.send({ token });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const existing = await usersCollection.findOne({ email: user.email });
      if (existing) return res.status(409).send({ message: "User already exists" });
      user.createdAt = new Date();
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/all-requests", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await requestCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send(user);
    });

    app.patch("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const updatedData = req.body;
        const result = await usersCollection.updateOne(
          { email: email },
          { $set: updatedData }
        );
        if (result.modifiedCount > 0) {
          res.send({ success: true, message: "User updated successfully" });
        } else {
          res.send({ success: false, message: "No changes detected or user not found" });
        }
      } catch (error) {
        console.error("Update user error:", error);
        res.status(500).send({ error: "Failed to update user" });
      }
    });

    app.get("/donations", async (req, res) => {
      try {
        const { donorEmail, limit = 3, sort = "desc" } = req.query;
        const query = donorEmail ? { donorEmail } : {};
        const sortOrder = sort === "desc" ? -1 : 1;
        const result = await requestCollection
          .find(query)
          .sort({ donationDate: sortOrder })
          .limit(parseInt(limit))
          .toArray();
        res.send(result);
      } catch (err) {
        console.error("Fetch donor requests error:", err);
        res.status(500).send({ message: "Failed to fetch donation requests" });
      }
    });

    app.patch("/donations/:id", async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;
      try {
        const result = await requestCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );
        res.send(result);
      } catch (err) {
        console.error("Update donation error:", err);
        res.status(500).send({ message: "Failed to update donation request" });
      }
    });

    app.delete("/donations/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const result = await requestCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (err) {
        console.error("Delete donation error:", err);
        res.status(500).send({ message: "Failed to delete donation request" });
      }
    });

    // ✅ Add more routes as needed

  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
  }
}

run().catch((err) => console.error("❌ Server Start Error:", err));

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});

