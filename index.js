const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
const app = express();
const port = 5000;
require("dotenv").config();
app.use(express.json());
app.use(cors());
app.get("/", (req, res) => {
  res.send("Hello World!");
});

const uri = process.env.MONGO_DB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("skillswap");
    const taskCollection = database.collection("tasks");
    const clientCollection = database.collection("clients");
    const proposalCollection = database.collection("proposals");
    const freelancerCollection = database.collection("freelancers");

    app.get("/api/tasks", async (req, res) => {
      const query = {};

      if (req.query.clientId) {
        query.clientId = req.query.clientId;
      }
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = await taskCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

     app.get("/api/tasks/public", async (req, res) => {
      const query = {
        status: "open",
      };

      if (req.query.category) {
        query.category = req.query.category;
      }

      if (req.query.search) {
        query.taskTitle = {
          $regex: req.query.search,
          $options: "i",
        };
      }

      const result = await taskCollection.find(query).toArray();

      res.json(result);
    });


    app.get("/api/tasks/:id", async (req, res)=>{
        const id = req.params.id;
        const query ={
          _id: new ObjectId(id)
        }
        const result = await taskCollection.findOne(query)
        res.send(result)
    })



    app.patch("/api/tasks/:id", async (req, res) => {

    const { id } = req.params;
    const updateData = req.body;

    const task = await taskCollection.findOne({ _id: new ObjectId(id) });
    const result = await taskCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    res.json(result);
  });


  app.delete("/api/tasks/:id", async (req, res) => {
 
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
    const result = await taskCollection.deleteOne({ _id: new ObjectId(id) });
    res.json(result);
  
});



    app.post("/api/tasks", async (req, res) => {
      const task = req.body;
      const newTask = {
        ...task,
        createdAt: new Date(),
      };
      const result = await taskCollection.insertOne(newTask);
      res.send(result);
    });

   
    // client API

    app.get("/api/profile/clients", async (req, res) => {
      const { clientId } = req.query;

      if (!clientId) {
        return res.status(400).json({ error: "clientId is required" });
      }

      const result = await clientCollection.findOne({ clientId });
      res.json(result || null);
    });

    app.post("/api/clients", async (req, res) => {
      const client = req.body;
      const newClient = {
        ...client,
        createdAt: new Date(),
      };
      const result = await clientCollection.insertOne(newClient);
      res.send(result);
    });

    app.patch("/api/profile/clients/:clientId", async (req, res) => {
      const { clientId } = req.params;
      const updateData = req.body;
      const result = await clientCollection.updateOne(
        { clientId },
        { $set: updateData },
      );
      res.json(result);
    });

    // Proposal related api

    app.post('/api/proposals',async(req,res) => {
      const proposal = req.body;
      const newProposal = {
        ...proposal,
        createdAt: new Date()
      }
      const result = await proposalCollection.insertOne(newProposal)
      res.json(result)
    } )
      // stats related api
    app.get("/api/stats/client/:clientId", async (req, res) => {
  
        const { clientId } = req.params;
        const tasks = await taskCollection.find({ clientId }).toArray();
        
        const totalTasks = tasks.length;
        const openTasks = tasks.filter(t => t.status === "open").length;
        const inProgressTasks = tasks.filter(t => t.status === "in-progress").length;
        const totalSpent = tasks
            .filter(t => t.status === "completed")
            .reduce((sum, t) => sum + (t.budget || 0), 0);

        res.json({ totalTasks, openTasks, inProgressTasks, totalSpent });
     
});


// freelancer related api
  app.get("/api/profile/freelancers", async (req, res) => {
  
    const { freelancerId } = req.query;
    if (!freelancerId) {
      return res.status(400).json({ error: "freelancerId is required" });
    }
    const result = await freelancerCollection.findOne({ freelancerId });
    res.json(result || null);
  
});


app.post("/api/freelancers", async (req, res) => {

    const freelancer = req.body;
    const newFreelancer = {
      ...freelancer,
      createdAt: new Date(),
    };
    const result = await freelancerCollection.insertOne(newFreelancer);
    res.json(result);
});


app.patch("/api/profile/freelancers/:freelancerId", async (req, res) => {
  
    const { freelancerId } = req.params;
    const updateData = req.body;
    const result = await freelancerCollection.updateOne(
      { freelancerId },
      { $set: updateData }
    );
    res.json(result);
});


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
