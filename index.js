const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");

const app = express();
const port = 5000;
require("dotenv").config();

app.use(express.json());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const uri = process.env.MONGO_DB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  await client.connect();

  const database = client.db("skillswap");
  const taskCollection = database.collection("tasks");
  const clientCollection = database.collection("clients");
  const proposalCollection = database.collection("proposals");
  const freelancerCollection = database.collection("freelancers");

  const authDb = client.db(process.env.AUTH_DB_NAME);
  const sessionCollection = authDb.collection("session");
  const userCollection = authDb.collection("user");

  const verifyToken = async (req, res, next) => {
    try {
      const authHeader = req.headers?.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized — no token" });
      }

      const token = authHeader.split(" ")[1];
      const session = await sessionCollection.findOne({ token });

      if (!session) {
        return res.status(401).json({ error: "Unauthorized — invalid token" });
      }

      const user = await userCollection.findOne({ _id: session.userId });
      if (!user) {
        return res.status(401).json({ error: "Unauthorized — user not found" });
      }

      req.user = user;
      next();
    } catch (err) {
      console.error("verifyToken error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  };

  const verifyAdmin = (req, res, next) => {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ error: "Forbidden — admin only" });
    }
    next();
  };

  try {
    // ASK ROUTES

    app.get("/api/tasks", async (req, res) => {
      const query = {};
      if (req.query.clientId) query.clientId = req.query.clientId;
      if (req.query.status) query.status = req.query.status;
      const result = await taskCollection.find(query).toArray();
      res.json(result);
    });

    app.get("/api/tasks/public", async (req, res) => {
      const query = { status: "open" };
      if (req.query.category) query.category = req.query.category;
      if (req.query.search) {
        query.taskTitle = { $regex: req.query.search, $options: "i" };
      }
      const result = await taskCollection.find(query).toArray();
      res.json(result);
    });

    app.get("/api/tasks/featured", async (req, res) => {
      const result = await taskCollection
        .find({ status: "open" })
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();
      res.json(result.map((t) => ({ ...t, _id: t._id.toString() })));
    });

    app.get("/api/tasks/:id", async (req, res) => {
      const result = await taskCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      res.json(result);
    });

    app.post("/api/tasks", verifyToken, async (req, res) => {
      try {
        const result = await taskCollection.insertOne({
          ...req.body,
          createdAt: new Date(),
        });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.patch("/api/tasks/:id", verifyToken, async (req, res) => {
      try {
        const result = await taskCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: req.body },
        );
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.patch("/api/tasks/:id/complete", verifyToken, async (req, res) => {
      try {
        const { deliverableUrl } = req.body;
        const result = await taskCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          {
            $set: {
              status: "completed",
              deliverableUrl,
              completedAt: new Date(),
            },
          },
        );
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.delete("/api/tasks/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const acceptedProposal = await proposalCollection.findOne({
          taskId: id,
          status: "accepted",
        });
        if (acceptedProposal) {
          return res
            .status(400)
            .json({ error: "Cannot delete a task with an accepted proposal" });
        }
        const result = await taskCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    //CLIENT ROUTES 

    app.get("/api/profile/clients", async (req, res) => {
      const { clientId } = req.query;
      if (!clientId) {
        return res.status(400).json({ error: "clientId is required" });
      }
      const result = await clientCollection.findOne({ clientId });
      res.json(result || null);
    });

    app.post("/api/clients", verifyToken, async (req, res) => {
      try {
        const result = await clientCollection.insertOne({
          ...req.body,
          createdAt: new Date(),
        });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.patch("/api/profile/clients/:clientId", verifyToken, async (req, res) => {
      try {
        const result = await clientCollection.updateOne(
          { clientId: req.params.clientId },
          { $set: req.body },
        );
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // PROPOSAL ROUTES 

    app.post("/api/proposals", verifyToken, async (req, res) => {
      try {
        const result = await proposalCollection.insertOne({
          ...req.body,
          createdAt: new Date(),
        });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get("/api/proposals", async (req, res) => {
      const { freelancerEmail } = req.query;
      if (!freelancerEmail) {
        return res.status(400).json({ error: "freelancerEmail is required" });
      }
      const proposals = await proposalCollection
        .find({ freelancerEmail })
        .toArray();
      const enriched = await Promise.all(
        proposals.map(async (proposal) => {
          const task = await taskCollection.findOne({
            _id: new ObjectId(proposal.taskId),
          });
          return {
            ...proposal,
            taskTitle: task?.taskTitle || "Unknown Task",
            taskCategory: task?.category || "",
            taskStatus: task?.status || "",
          };
        }),
      );
      res.json(enriched);
    });

    app.get("/api/proposals/client/:clientId", async (req, res) => {
      const { clientId } = req.params;
      const tasks = await taskCollection.find({ clientId }).toArray();
      const taskIds = tasks.map((t) => t._id.toString());
      if (taskIds.length === 0) return res.json([]);
      const proposals = await proposalCollection
        .find({ taskId: { $in: taskIds } })
        .toArray();
      const enriched = proposals.map((proposal) => {
        const task = tasks.find((t) => t._id.toString() === proposal.taskId);
        return {
          ...proposal,
          _id: proposal._id.toString(),
          taskTitle: task?.taskTitle || "Unknown Task",
          taskCategory: task?.category || "",
          taskBudget: task?.budget || 0,
          taskStatus: task?.status || "",
        };
      });
      res.json(enriched);
    });

    app.patch("/api/proposals/:id/accept", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const proposal = await proposalCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!proposal)
          return res.status(404).json({ error: "Proposal not found" });

        const alreadyAccepted = await proposalCollection.findOne({
          taskId: proposal.taskId,
          status: "accepted",
        });
        if (alreadyAccepted) {
          return res.status(400).json({
            error: "A proposal has already been accepted for this task",
          });
        }

        await proposalCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "accepted" } },
        );
        await proposalCollection.updateMany(
          { taskId: proposal.taskId, _id: { $ne: new ObjectId(id) } },
          { $set: { status: "rejected" } },
        );
        await taskCollection.updateOne(
          { _id: new ObjectId(proposal.taskId) },
          { $set: { status: "in-progress" } },
        );

        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.patch("/api/proposals/:id/reject", verifyToken, async (req, res) => {
      try {
        const result = await proposalCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { status: "rejected" } },
        );
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // STATS ROUTES

    app.get("/api/stats/client/:clientId", async (req, res) => {
      const { clientId } = req.params;
      const tasks = await taskCollection.find({ clientId }).toArray();
      res.json({
        totalTasks: tasks.length,
        openTasks: tasks.filter((t) => t.status === "open").length,
        inProgressTasks: tasks.filter((t) => t.status === "in-progress").length,
        totalSpent: tasks
          .filter((t) => t.status === "completed")
          .reduce((sum, t) => sum + (t.budget || 0), 0),
      });
    });

    app.get("/api/stats/freelancer/:freelancerEmail", async (req, res) => {
      const proposals = await proposalCollection
        .find({ freelancerEmail: decodeURIComponent(req.params.freelancerEmail) })
        .toArray();
      res.json({
        totalProposals: proposals.length,
        pendingProposals: proposals.filter((p) => p.status === "pending").length,
        acceptedProposals: proposals.filter((p) => p.status === "accepted").length,
        totalEarnings: proposals
          .filter((p) => p.status === "accepted")
          .reduce((sum, p) => sum + (p.budget || 0), 0),
      });
    });

    // FREELANCER ROUTES

    app.get("/api/profile/freelancers", async (req, res) => {
      const { freelancerId } = req.query;
      if (!freelancerId) {
        return res.status(400).json({ error: "freelancerId is required" });
      }
      const result = await freelancerCollection.findOne({ freelancerId });
      res.json(result || null);
    });

    app.post("/api/freelancers", verifyToken, async (req, res) => {
      try {
        const result = await freelancerCollection.insertOne({
          ...req.body,
          createdAt: new Date(),
        });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get("/api/freelancers", async (req, res) => {
      const result = await freelancerCollection.find({}).toArray();
      res.json(result.map((f) => ({ ...f, _id: f._id.toString() })));
    });

    app.get("/api/freelancers/top", async (req, res) => {
      const result = await freelancerCollection.find({}).limit(6).toArray();
      res.json(result.map((f) => ({ ...f, _id: f._id.toString() })));
    });

    app.get("/api/freelancers/:freelancerId", async (req, res) => {
      const freelancer = await freelancerCollection.findOne({
        freelancerId: req.params.freelancerId,
      });
      if (!freelancer)
        return res.status(404).json({ error: "Freelancer not found" });
      res.json({ ...freelancer, _id: freelancer._id.toString() });
    });

    app.patch("/api/profile/freelancers/:freelancerId", verifyToken, async (req, res) => {
      try {
        const result = await freelancerCollection.updateOne(
          { freelancerId: req.params.freelancerId },
          { $set: req.body },
        );
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // PROJECT & EARNINGS ROUTES

    app.get("/api/projects/freelancer/:freelancerEmail", async (req, res) => {
      const freelancerEmail = decodeURIComponent(req.params.freelancerEmail);
      const acceptedProposals = await proposalCollection
        .find({ freelancerEmail, status: "accepted" })
        .toArray();
      if (acceptedProposals.length === 0) return res.json([]);
      const taskIds = acceptedProposals.map((p) => new ObjectId(p.taskId));
      const tasks = await taskCollection
        .find({ _id: { $in: taskIds }, status: { $in: ["in-progress", "completed"] } })
        .toArray();
      const enriched = tasks.map((task) => {
        const proposal = acceptedProposals.find(
          (p) => p.taskId === task._id.toString(),
        );
        return {
          ...task,
          _id: task._id.toString(),
          proposalBudget: proposal?.budget || 0,
          proposalDays: proposal?.days || 0,
        };
      });
      res.json(enriched);
    });

    app.get("/api/earnings/freelancer/:freelancerEmail", async (req, res) => {
      const freelancerEmail = decodeURIComponent(req.params.freelancerEmail);
      const acceptedProposals = await proposalCollection
        .find({ freelancerEmail, status: "accepted" })
        .toArray();
      if (acceptedProposals.length === 0) return res.json([]);
      const taskIds = acceptedProposals.map((p) => new ObjectId(p.taskId));
      const completedTasks = await taskCollection
        .find({ _id: { $in: taskIds }, status: "completed" })
        .toArray();
      const enriched = await Promise.all(
        completedTasks.map(async (task) => {
          const proposal = acceptedProposals.find(
            (p) => p.taskId === task._id.toString(),
          );
          const clientProfile = await clientCollection.findOne({
            clientId: task.clientId,
          });
          return {
            _id: task._id.toString(),
            taskTitle: task.taskTitle,
            clientName: clientProfile?.name || "Unknown Client",
            amountEarned: proposal?.budget || 0,
            completedAt: task.completedAt || null,
            deliverableUrl: task.deliverableUrl || null,
          };
        }),
      );
      res.json(enriched);
    });

    //  ADMIN ROUTES
    app.delete("/api/admin/tasks/:id", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await taskCollection.deleteOne({
          _id: new ObjectId(req.params.id),
        });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get("/api/admin/users", verifyToken, verifyAdmin, async (req, res) => {
      const db = client.db(process.env.AUTH_DB_NAME);
      const users = await db.collection("user").find({}).toArray();
      res.json(users.map((u) => ({ ...u, _id: u._id.toString() })));
    });

    app.patch("/api/admin/users/:id/block", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const db = client.db(process.env.AUTH_DB_NAME);
        const result = await db
          .collection("user")
          .updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { banned: req.body.banned } },
          );
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get("/api/admin/stats", verifyToken, verifyAdmin, async (req, res) => {
      const db = client.db(process.env.AUTH_DB_NAME);
      const totalUsers = await db.collection("user").countDocuments();
      const totalTasks = await taskCollection.countDocuments();
      const activeTasks = await taskCollection.countDocuments({
        status: { $in: ["open", "in-progress"] },
      });
      const completedTasks = await taskCollection
        .find({ status: "completed" })
        .toArray();
      const totalRevenue = completedTasks.reduce(
        (sum, t) => sum + (t.budget || 0),
        0,
      );
      res.json({ totalUsers, totalTasks, activeTasks, totalRevenue });
    });

    app.get("/api/admin/transactions", verifyToken, verifyAdmin, async (req, res) => {
      const accepted = await proposalCollection
        .find({ status: "accepted" })
        .toArray();
      const enriched = await Promise.all(
        accepted.map(async (proposal) => {
          const task = await taskCollection.findOne({
            _id: new ObjectId(proposal.taskId),
          });
          const db = client.db(process.env.AUTH_DB_NAME);
          const clientUser = await db
            .collection("user")
            .findOne({ id: task?.clientId });
          return {
            _id: proposal._id.toString(),
            clientEmail: clientUser?.email || "Unknown",
            freelancerEmail: proposal.freelancerEmail,
            amount: proposal.budget || 0,
            date: proposal.createdAt,
            status: task?.status || "unknown",
          };
        }),
      );
      res.json(enriched);
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch (err) {
    console.error("Startup error:", err);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});