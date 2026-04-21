import { app } from "./src/app.js";
import { connectDB } from "./src/config/db.js";
import { env } from "./src/config/env.js";
import { seedAdmin, seedDemoUsers } from "./src/utils/seedAdmin.js";

// Connect to MongoDB, seed admin, then start the server
connectDB()
  .then(async () => {
    await seedAdmin();
    await seedDemoUsers();
    app.listen(env.PORT || 5000, "0.0.0.0", () => {
      console.log(`\n⚙️  Server is running at port: ${env.PORT}`);
    });
  })
  .catch((err) => {
    console.error("MONGO db connection failed !!! ", err);
  });
