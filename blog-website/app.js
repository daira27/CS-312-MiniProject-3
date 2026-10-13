// This is my main server file
require("dotenv").config();
const session = require("express-session");
const { Pool } = require("pg");

//PostgreSQL connection
const db = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT)
});

//database connection
db.query("SELECT NOW()")
    .then((result) => {
        console.log("Connected to PostgreSQL!");
        console.log("Database time:", result.rows[0].now);
    })
    .catch((error) => {
        console.error("Database connection failed:", error.message);
    });

const express = require("express");

const app = express();
const PORT = 3000;
// im using bcrypt as a personal preference so i can get more practice
// (bcrypt is a lib for hashing passwords)
const bcrypt = require("bcrypt");

app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false 
  }
}));

// this uses my styling
app.use(express.static("public"));

app.set("view engine", "ejs");

////// sign up page
app.get("/signup", (req, res) => {
  res.render("signup");
});

app.post("/signup", async (req, res) => {
  const { user_id, password, name } = req.body;

  try 
  {
      // check to see if the username already exists
      const existingUser = await db.query(
          "SELECT * FROM users WHERE user_id = $1",
          [user_id]
      );

      if (existingUser.rows.length > 0) {
          return res.status(409).send(
              'Username already taken. <a href="/signup">Try again</a>'
          );
      }

      // Using bcrypt to hash the password before storing it for security reasons
      const hashedPassword = await bcrypt.hash(password, 12);

      // Insert new user into PostgreSQL
      await db.query(
          "INSERT INTO users (user_id, password, name) VALUES ($1, $2, $3)",
          [user_id, hashedPassword, name]
      );

      // Redirecting to sign-in page
      res.redirect("/signin");

  } 

    catch (error) 
    {
        console.error("Signup error:", error);
        res.status(500).send("Something went wrong during signup.");
    }
});


// Sign in page
app.get("/signin", (req, res) => {
  res.render("signin");
});


app.post("/signin", async (req, res) => {
  const { user_id, password } = req.body;

  try {
      // Find user in PostgreSQL
      const result = await db.query(
          "SELECT * FROM users WHERE user_id = $1",
          [user_id]
      );

      if (result.rows.length === 0) {
          return res.status(401).send(
              'Invalid username or password. <a href="/signin">Try again</a>'
          );
      }

      const user = result.rows[0];

      // Verify password comparing hashed pw
      const validPassword = await bcrypt.compare(
          password,
          user.password
      );

      if (!validPassword) {
          return res.status(401).send(
              'Invalid username or password. <a href="/signin">Try again</a>'
          );
      }

      // Regenerate session when logging in
      req.session.regenerate((error) => {
          if (error) {
              console.error(error);
              return res.status(500).send("Sign-in failed.");
          }

          // Stay logged in
          req.session.user = {
              user_id: user.user_id,
              name: user.name
          };

          req.session.save((error) => {
              if (error) {
                  console.error(error);
                  return res.status(500).send("Sign-in failed.");
              }

              res.redirect("/");
          });
      });

  } catch (error) {
      console.error("Signin error:", error);
      res.status(500).send("Something went wrong during signin.");
  }
});

// let user logout
app.post("/logout", (req, res) => {
  req.session.destroy((error) => {
      if (error) {
          return res.status(500).send("Logout failed.");
      }

      res.clearCookie("connect.sid");
      res.redirect("/signin");
  });
});


// post viewing
// home page

app.get("/", async (req, res) => {
  try 
  {
      const result = await db.query(
          "SELECT * FROM blogs ORDER BY date_created DESC"
      );

      const posts = result.rows.map(blog => ({
          id: blog.blog_id,
          creator: blog.creator_name,
          title: blog.title,
          content: blog.body,
          createdAt: blog.date_created,
          creator_user_id: blog.creator_user_id
      }));

      res.render("index", {
          posts,
          user: req.session.user || null
      });

  } 
  catch (error) 
  {
      console.error("Error loading posts:", error);
      res.status(500).send("Error loading blog posts.");
  }
});

  
// post creation
// create new post

app.post("/posts", async (req, res) => {
  // Only signed-in users can create posts
  if (!req.session.user) {
      return res.redirect("/signin");
  }

  const { title, content } = req.body;

  const user_id = req.session.user.user_id;
  const creator = req.session.user.name;

  if (!title?.trim() || !content?.trim()) {
      return res.status(400).send("Title and content are required.");
  }

  try {
      await db.query(
          `INSERT INTO blogs
          (creator_name, creator_user_id, title, body, date_created)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
          [creator, user_id, title, content]
      );

      res.redirect("/");

  } catch (error) {
      console.error("Error creating post:", error);
      res.status(500).send("Error creating post.");
  }
});


// post editing

app.get("/edit/:id", async (req, res) => {
  if (!req.session.user) 
  {
      return res.redirect("/signin");
  }

  try 
  {
      const result = await db.query(
          "SELECT * FROM blogs WHERE blog_id = $1",
          [req.params.id]
      );

      if (result.rows.length === 0) {
          return res.status(404).send("Post not found.");
      }

      const blog = result.rows[0];

      // Check if current user owns the blog, bc they can only edit if its their own
      if (blog.creator_user_id !== req.session.user.user_id) {
          return res.status(403).send(
              "You can only edit your own posts."
          );
      }

      const post = {
          id: blog.blog_id,
          creator: blog.creator_name,
          title: blog.title,
          content: blog.body
      };

      res.render("edit", { post });

  } 
  catch (error) 
  {
      console.error("Error loading edit page:", error);
      res.status(500).send("Error loading post.");
  }
});


// update edits
app.post("/edit/:id", async (req, res) => {
  if (!req.session.user) {
      return res.redirect("/signin");
  }

  const { title, content } = req.body;

  if (!title?.trim() || !content?.trim()) 
  {
      return res.status(400).send("Title and content are required.");
  }

  try 
  {
      const result = await db.query(
          `UPDATE blogs
           SET title = $1, body = $2
           WHERE blog_id = $3
           AND creator_user_id = $4
           RETURNING blog_id`,
          [
              title,
              content,
              req.params.id,
              req.session.user.user_id
          ]
      );

      if (result.rowCount === 0) {
          return res.status(404).send(
              "Post not found or you do not have permission to edit it."
          );
      }

      res.redirect("/");

  } 
  catch (error) 
  {
      console.error("Error updating post:", error);
      res.status(500).send("Error updating post.");
  }
});


// Post deletion

app.post("/delete/:id", async (req, res) => {
  if (!req.session.user) {
      return res.redirect("/signin");
  }

  try {
      const result = await db.query(
          `DELETE FROM blogs
           WHERE blog_id = $1
           AND creator_user_id = $2
           RETURNING blog_id`,
          [
              req.params.id,
              req.session.user.user_id
          ]
      );

      if (result.rowCount === 0) {
          return res.status(404).send(
              "Post not found or you do not have permission to delete it."
          );
      }

      res.redirect("/");

  } catch (error) {
      console.error("Error deleting post:", error);
      res.status(500).send("Error deleting post.");
  }
});


// start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});