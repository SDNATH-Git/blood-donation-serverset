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

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.y7n1te0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// JWT Middleware: Token ভেরিফাই করার জন্য
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

async function run() {
  try {
    const db = client.db("BloodDonationDB");

    const usersCollection = db.collection("users");
    const requestCollection = db.collection("requests");

    console.log("✅ Connected to MongoDB");

    // Root
    app.get("/", (req, res) => {
      res.send("🩸 Blood Donation Server is Running!");
    });

    // JWT তৈরি করা
    app.post("/jwt", (req, res) => {
      const user = req.body;
      if (!user?.email || !user?.role) {
        return res.status(400).send({ message: "Email and role required." });
      }
      const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "7d" });
      res.send({ token });
    });

    // ইউজার রেজিস্ট্রেশন
    app.post("/users", async (req, res) => {
      const user = req.body;
      const existing = await usersCollection.findOne({ email: user.email });
      if (existing) return res.status(409).send({ message: "User already exists" });
      user.createdAt = new Date();
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // ইউজার তথ্য পাওয়া
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send(user);
    });

    // ইউজার আপডেট
    app.patch("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const updatedData = req.body;
        const result = await usersCollection.updateOne(
          { email },
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

    // ডোনার সার্চ
    app.get("/users", async (req, res) => {
      try {
        const { bloodGroup, district, upazila } = req.query;
        const query = { status: "active" };
        if (bloodGroup) query.blood = bloodGroup;
        if (district) query.district = district;
        if (upazila) query.upazila = upazila;

        const users = await usersCollection.find(query).toArray();
        res.send(users);
      } catch (error) {
        console.error("Donor search error:", error);
        res.status(500).send({ message: "Server error during donor search" });
      }
    });

    // ডোনেশন রিকোয়েস্ট তৈরি
    app.post("/requests", async (req, res) => {
      try {
        const request = req.body;
        request.status = "pending";
        request.createdAt = new Date();
        const result = await requestCollection.insertOne(request);
        res.send(result);
      } catch (err) {
        console.error("Create request error:", err);
        res.status(500).send({ error: "Something went wrong" });
      }
    });

    // নিজের ডোনেশন রিকোয়েস্ট গুলো পাওয়া
    app.get("/requests", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ message: "Email is required" });

      const result = await requestCollection
        .find({
          $or: [
            { requestedBy: email },
            { requesterEmail: email } // fallback
          ]
        })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    });

    // একক রিকোয়েস্ট পাওয়া
    app.get("/requests/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const request = await requestCollection.findOne({ _id: new ObjectId(id) });
        if (!request) return res.status(404).send({ message: "Request not found" });
        res.send(request);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch request" });
      }
    });

    // রিকোয়েস্ট আপডেট করা (PATCH)
    app.patch("/requests/:id", async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;
      try {
        const result = await requestCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );
        if (result.modifiedCount > 0) {
          res.send({ success: true, message: "Request updated successfully" });
        } else {
          res.send({ success: false, message: "No changes detected or request not found" });
        }
      } catch (error) {
        console.error("Update request error:", error);
        res.status(500).send({ success: false, message: "Failed to update request" });
      }
    });

    // রিকোয়েস্ট ডিলিট করা
    app.delete("/requests/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const result = await requestCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount > 0) {
          res.send({ success: true, message: "Request deleted successfully" });
        } else {
          res.send({ success: false, message: "Request not found" });
        }
      } catch (error) {
        console.error("Delete request error:", error);
        res.status(500).send({ success: false, message: "Failed to delete request" });
      }
    });

    // ইউজারের role ফেরত পাঠানো
app.get("/users/role/:email", async (req, res) => {
  const email = req.params.email;
  const user = await client.db("BloodDonationDB").collection("users").findOne({ email });

  if (!user) {
    return res.status(404).send({ role: null });
  }

  res.send({ role: user.role });
});



    // Admin-only: সব রিকোয়েস্ট দেখতে পারবে
    app.get("/all-requests", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await requestCollection.find().toArray();
      res.send(result);
    });

  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
  }
}

run().catch((err) => console.error("❌ Server Start Error:", err));

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
