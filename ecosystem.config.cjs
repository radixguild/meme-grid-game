module.exports = {
  apps: [
    {
      name: "meme-grid-server",
      cwd: "./server",
      script: "dist/index.js",
      node_args: "--enable-source-maps",
      env: {
        NODE_ENV: "production",
        PORT: 3004,
        HOST: "127.0.0.1",
      },
      // Secrets loaded from this project's own server/secrets.env (see
      // server/src/config/load-env.ts) — never another project's path.
      // Additional non-secret vars set in server/.env on the deploy host.
      max_memory_restart: "256M",
      restart_delay: 3000,
      max_restarts: 10,
    },
    {
      name: "meme-grid-app",
      cwd: ".",
      script: "node_modules/.bin/next",
      args: "start -H 127.0.0.1 -p 3005",
      env: {
        NODE_ENV: "production",
        PORT: 3005,
      },
      max_memory_restart: "512M",
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
};
