import app from "./app.js";

const PORT = process.env.PORT || 4000;

// Express 5 passes listen errors (e.g. EADDRINUSE) to this callback instead of throwing
app.listen(PORT, (err) => {
  if (err) {
    console.error(`Server start failed on port ${PORT}:`, err.message || err.code);
    process.exit(1);
  }
  console.log(`API running on http://localhost:${PORT}`);
});