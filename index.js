require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { v4: uuidv4 } = require('uuid');

// মেমোরিতে ফান্ড ডেটা (ডাটাবেস না থাকলে)
let funds = [];

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
  if (!authHeader)
    return res.status(401).send({ message: "Unauthorized. Token missing." });

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err)
      return res.status(403).send({ message: "Forbidden. Invalid token." });
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
    const fundsCollection = db.collection("funds");
    const blogsCollection = db.collection("blogs");
    const donationRequestsCollection = db.collection("donationRequests");
    


    console.log("✅ Connected to MongoDB");

    // Root route
    app.get("/", (req, res) => {
      res.send("🩸 Blood Donation Server is Running!");
    });

    // JWT তৈরি করা - এখানে ইউজারের role DB থেকে নিয়ে টোকেনে যোগ করবো
    app.post("/jwt", async (req, res) => {
      const { email } = req.body;
      if (!email) {
        return res.status(400).send({ message: "Email is required." });
      }

      const user = await usersCollection.findOne({ email });
      if (!user) {
        return res.status(404).send({ message: "User not found." });
      }

      const tokenPayload = {
        email: user.email,
        role: user.role || "donor",
      };

      const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });
      res.send({ token });
    });

 // নতুন middleware - volunteer বা admin উভয়ের জন্য access দিবে
const verifyVolunteerOrAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  const user = await usersCollection.findOne({ email });

  if (!user || !["volunteer", "admin"].includes(user.role)) {
    return res.status(403).send({ error: true, message: "forbidden access" });
  }
  next();
};


    // ইউজার রেজিস্ট্রেশন
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        if (!user.email) {
          return res.status(400).send({ message: "Email is required" });
        }
        const existing = await usersCollection.findOne({ email: user.email });
        if (existing)
          return res.status(409).send({ message: "User already exists" });

        // ডিফল্ট role ও status দেয়া
        user.role = user.role || "donor";
        user.status = user.status || "active";
        user.createdAt = new Date();

        const result = await usersCollection.insertOne(user);
        res.send({ success: true, message: "User created", insertedId: result.insertedId });
      } catch (error) {
        console.error("User registration error:", error);
        res.status(500).send({ message: "Failed to create user" });
      }
    });

    // users block unblock 
    app.get("/users", async (req, res) => {
    try {
    const { bloodGroup, district, upazila, status } = req.query;
    const query = {};

    // status যদি থাকে এবং all না হয়, তখন সেট করবে
    if (status && status !== "all") {
      query.status = status;
    }

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


    // ইউজার তথ্য পাওয়া
    app.get("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        if (!user)
          return res.status(404).send({ message: "User not found" });
        res.send(user);
      } catch (error) {
        console.error("Get user error:", error);
        res.status(500).send({ message: "Failed to get user" });
      }
    });


    // ইউজার আপডেট (email দিয়ে)
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
        res.status(500).send({ message: "Failed to update user" });
      }
    });

    // ডোনার সার্চ (status active থাকা ইউজার)
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
        res.send({ success: true, message: "Request created", insertedId: result.insertedId });
      } catch (err) {
        console.error("Create request error:", err);
        res.status(500).send({ message: "Something went wrong" });
      }
    });

    // নিজের ডোনেশন রিকোয়েস্ট গুলো পাওয়া (email দিয়ে)
    app.get("/requests", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) return res.status(400).send({ message: "Email is required" });

        const result = await requestCollection
          .find({
            $or: [{ requestedBy: email }, { requesterEmail: email }],
          })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Get requests error:", error);
        res.status(500).send({ message: "Failed to get requests" });
      }
    });

    // একক রিকোয়েস্ট পাওয়া (id দিয়ে)
    app.get("/requests/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid request id" });

        const request = await requestCollection.findOne({ _id: new ObjectId(id) });
        if (!request) return res.status(404).send({ message: "Request not found" });
        res.send(request);
      } catch (err) {
        console.error("Get request error:", err);
        res.status(500).send({ message: "Failed to fetch request" });
      }
    });

    // রিকোয়েস্ট আপডেট (PATCH)
    app.patch("/requests/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid request id" });

        const updateData = req.body;
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
        res.status(500).send({ message: "Failed to update request" });
      }
    });

    // রিকোয়েস্ট ডিলিট (DELETE)
    app.delete("/requests/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid request id" });

        const result = await requestCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount > 0) {
          res.send({ success: true, message: "Request deleted successfully" });
        } else {
          res.send({ success: false, message: "Request not found" });
        }
      } catch (error) {
        console.error("Delete request error:", error);
        res.status(500).send({ message: "Failed to delete request" });
      }
    });

    // ইউজারের role ফেরত পাঠানো
    app.get("/users/role/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        if (user) {
          res.send({ role: user.role });
        } else {
          res.status(404).send({ role: null });
        }
      } catch (error) {
        console.error("Get user role error:", error);
        res.status(500).send({ message: "Failed to get user role" });
      }
    });

    // Fund গুলো সব পাওয়া
    app.get("/funds", async (req, res) => {
      try {
        const funds = await fundsCollection.find().toArray();
        res.send(funds);
      } catch (error) {
        console.error("Get funds error:", error);
        res.status(500).send({ message: "Failed to fetch funds" });
      }
    });

    // Fund যোগ করা
    app.post("/funds", async (req, res) => {
      try {
        const fund = req.body;
        fund.createdAt = new Date();
        const result = await fundsCollection.insertOne(fund);
        res.send({ success: true, message: "Fund added", insertedId: result.insertedId });
      } catch (error) {
        console.error("Add fund error:", error);
        res.status(500).send({ message: "Failed to add fund" });
      }
    });

    // =================
    // USER ACTIONS (block, unblock, make volunteer/admin)
    // =================

    // block user: status -> "blocked"
    app.patch("/users/block/:id", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid user id" });

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "blocked" } }
        );

        if (result.modifiedCount > 0) {
          res.send({ success: true, message: "User blocked successfully" });
        } else {
          res.send({ success: false, message: "User not found or already blocked" });
        }
      } catch (error) {
        console.error("Block user error:", error);
        res.status(500).send({ message: "Failed to block user" });
      }
    });

    // unblock user: status -> "active"
    app.patch("/users/unblock/:id", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid user id" });

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "active" } }
        );

        if (result.modifiedCount > 0) {
          res.send({ success: true, message: "User unblocked successfully" });
        } else {
          res.send({ success: false, message: "User not found or already active" });
        }
      } catch (error) {
        console.error("Unblock user error:", error);
        res.status(500).send({ message: "Failed to unblock user" });
      }
    });

    // make volunteer: role -> "volunteer"
    app.patch("/users/make-volunteer/:id", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid user id" });

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: "volunteer" } }
        );

        if (result.modifiedCount > 0) {
          res.send({ success: true, message: "User made volunteer successfully" });
        } else {
          res.send({ success: false, message: "User not found or already volunteer" });
        }
      } catch (error) {
        console.error("Make volunteer error:", error);
        res.status(500).send({ message: "Failed to make volunteer" });
      }
    });

    // make admin: role -> "admin"
    app.patch("/users/make-admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid user id" });

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: "admin" } }
        );

        if (result.modifiedCount > 0) {
          res.send({ success: true, message: "User made admin successfully" });
        } else {
          res.send({ success: false, message: "User not found or already admin" });
        }
      } catch (error) {
        console.error("Make admin error:", error);
        res.status(500).send({ message: "Failed to make admin" });
      }
    });

// Admin-only: সব রিকোয়েস্ট দেখতে পারবে
    app.get("/all-requests", verifyJWT, async (req, res) => {
  const email = req.decoded.email;
  const user = await usersCollection.findOne({ email });

  if (!user || (user.role !== "admin" && user.role !== "volunteer")) {
    return res.status(403).send({ message: "Forbidden" });
  }

  try {
    const result = await requestCollection.find().toArray();
    res.send(result);
  } catch (error) {
    console.error("Get all requests error:", error);
    res.status(500).send({ message: "Failed to fetch requests" });
  }
});




// ব্লগ লিস্ট (status filter দিয়ে)
app.get("/blogs", verifyJWT, async (req, res) => {
  try {
    const status = req.query.status;
    const query = {};
    if (status && status !== "all") {
      query.status = status;
    }
    const blogs = await blogsCollection.find(query).sort({ createdAt: -1 }).toArray();
    res.send(blogs);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch blogs" });
  }
});

// ব্লগ তৈরি
app.post("/blogs", verifyJWT, async (req, res) => {
  try {
    const blog = req.body;
    blog.status = "draft";
    blog.createdAt = new Date();
    blog.updatedAt = new Date();
    blog.authorEmail = req.decoded.email;
    const result = await blogsCollection.insertOne(blog);
    res.send({ success: true, insertedId: result.insertedId });
  } catch (err) {
    res.status(500).send({ message: "Failed to create blog" });
  }
});

// ব্লগ পাবলিশ করা (admin only)
app.patch("/blogs/publish/:id", verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid blog id" });

    const result = await blogsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "published", updatedAt: new Date() } }
    );
    if (result.modifiedCount > 0) {
      res.send({ success: true, message: "Blog published" });
    } else {
      res.send({ success: false, message: "Blog not found or already published" });
    }
  } catch (err) {
    res.status(500).send({ message: "Failed to publish blog" });
  }
});

// ব্লগ আনপাবলিশ করা (admin only)
app.patch("/blogs/unpublish/:id", verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid blog id" });

    const result = await blogsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "draft", updatedAt: new Date() } }
    );
    if (result.modifiedCount > 0) {
      res.send({ success: true, message: "Blog unpublished" });
    } else {
      res.send({ success: false, message: "Blog not found or already draft" });
    }
  } catch (err) {
    res.status(500).send({ message: "Failed to unpublish blog" });
  }
});

// ব্লগ ডিলিট (admin only)
app.delete("/blogs/:id", verifyJWT, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid blog id" });

  const result = await blogsCollection.deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount > 0) {
    res.send({ success: true, message: "Blog deleted successfully" });
  } else {
    res.status(404).send({ success: false, message: "Blog not found" });
  }
});

// GET only published blogs
app.get("/blogs/published", async (req, res) => {
  try {
    const publishedBlogs = await blogsCollection
      .find({ status: "published" })
      .toArray();
    res.send(publishedBlogs);
  } catch (error) {
    console.error("Error fetching published blogs:", error);
    res.status(500).send({ message: "Failed to fetch published blogs" });
  }
});

// Single published blog by ID
app.get("/blogs/publish/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const blog = await blogsCollection.findOne({
      _id: new ObjectId(id),
      status: "published", // Only if published
    });

    if (!blog) {
      return res.status(404).send({ message: "Blog not found or not published." });
    }

    res.send(blog);
  } catch (error) {
    console.error("Error fetching published blog:", error);
    res.status(500).send({ message: "Failed to fetch blog." });
  }
});


// Update blog by ID (title, content, thumbnailUrl)
app.patch("/blogs/:id", verifyJWT, async (req, res) => {
    const id = req.params.id;
    const updatedBlog = req.body;

    try {
        const result = await blogsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    title: updatedBlog.title,
                    content: updatedBlog.content,
                    thumbnailUrl: updatedBlog.thumbnailUrl || "",
                },
            }
        );

        if (result.modifiedCount > 0) {
            res.send({ success: true });
        } else {
            res.status(404).send({ message: "Blog not updated." });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal Server Error" });
    }
});

// GET blog by ID
app.get("/blogs/:id", async (req, res) => {
  const id = req.params.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid blog ID" });
  }

  try {
    const blog = await blogsCollection.findOne({ _id: new ObjectId(id) });
    if (!blog) {
      return res.status(404).json({ message: "Blog not found" });
    }
    res.json(blog);
  } catch (error) {
    console.error("Error fetching blog by ID:", error);
    res.status(500).json({ message: "Server error" });
  }
});



// Publish Blog
app.patch("/blogs/publish/:id", verifyJWT, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const result = await blogsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: "published" } }
  );
  res.send(result);
});

// Unpublish Blog
app.patch("/blogs/unpublish/:id", verifyJWT, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const result = await blogsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: "draft" } }
  );
  res.send(result);
});

// Update donation status (volunteer & admin)
app.patch("/donations/update-status/:id", verifyJWT, async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid request id" });
  }

  const email = req.decoded.email;
  const user = await usersCollection.findOne({ email });

  if (!["admin", "volunteer"].includes(user?.role)) {
    return res.status(403).send({ message: "Forbidden" });
  }

  const result = await requestCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status } }
  );

  res.send(result);
});


// route: GET /volunteer-requests
app.get('/volunteer-requests', verifyJWT, verifyVolunteerOrAdmin, async (req, res) => {
  try {
    const requests = await requestCollection.find({
      status: { $in: ['pending', 'approved'] } 
    }).toArray();

    res.send(requests);
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch volunteer requests.' });
  }
});

// GET all pending blood donation requests (Public)
app.get("/donations/pending", async (req, res) => {
  try {
    const pendingRequests = await requestCollection.find({ status: "pending" }).toArray();
    res.send(pendingRequests);
  } catch (error) {
    console.error("Error fetching pending donations:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

///
app.get("/donations/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const donation = await requestCollection.findOne({ _id: new ObjectId(id) });

    if (!donation) {
      return res.status(404).send({ message: "Donation request not found" });
    }

    res.send(donation);
  } catch (error) {
    console.error("Error fetching donation:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

//////
app.get("/all-requests", async (req, res) => {
  try {
    const requests = await requestCollection.find().toArray();
    res.send(requests);
  } catch (error) {
    console.error("Error fetching requests:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

// Update donation status (for donor)
app.patch("/donations/start/:id", verifyJWT, async (req, res) => {
  const id = req.params.id;
  const email = req.decoded.email;
  const user = await usersCollection.findOne({ email });

  if (user?.status !== "active") {
    return res.status(403).send({ message: "Only active users can donate" });
  }

  const result = await donationRequestsCollection.updateOne(
    { _id: new ObjectId(id), status: "pending" },
    { $set: { status: "inprogress", donorName: user.name, donorEmail: user.email } }
  );

  res.send(result);
});

// POST /create-payment-intent
app.post("/create-payment-intent", async (req, res) => {
    const { amount } = req.body;
    const paymentIntent = await stripe.paymentIntents.create({
        amount: amount * 100, // Stripe works in cents
        currency: "usd",
        payment_method_types: ["card"],
    });

    res.send({ clientSecret: paymentIntent.client_secret });
});


// Payment Intent তৈরির রাউট
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // ডলার থেকে সেন্টে
      currency: "usd",
      metadata: { integration_check: 'accept_a_payment' },
    });

    res.json(paymentIntent.client_secret);
  } catch (error) {
    console.error("PaymentIntent error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ফান্ড ডেটা সেভ করার রাউট
app.post('/funds', (req, res) => {
  const { name, email, amount, date } = req.body;
  if (!name || !email || !amount || !date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const newFund = {
    _id: uuidv4(),
    name,
    email,
    amount,
    date,
  };

  funds.push(newFund);
  res.status(201).json({ message: "Fund saved", fund: newFund });
});

// সব ফান্ড রিটার্ন করার রাউট
app.get('/funds', (req, res) => {
  res.json(funds);
});


///
app.patch('/donations/start/:id', verifyJWT, async (req, res) => {
  const id = req.params.id;

  try {
    const result = await donationRequestsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'inprogress' } }
    );

    if (result.modifiedCount > 0) {
      res.send({ message: "Donation started successfully." });
    } else {
      res.status(404).send({ message: "Request not found or already updated." });
    }
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Server error." });
  }
});











  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
  }
}

run().catch((err) => console.error("❌ Server Start Error:", err));

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
