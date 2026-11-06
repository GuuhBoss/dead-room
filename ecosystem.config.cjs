const baseApp = {
  cwd: __dirname,
  script: 'pnpm',
  interpreter: 'none',
  watch: false,
  autorestart: true,
  time: true,
  restart_delay: 5000,
  max_restarts: 10,
}

module.exports = {
  apps: [
    {
      ...baseApp,
      name: 'dead-rooms-dev',
      args: 'run dev',
      env: { NODE_ENV: 'development', PORT: 3331 },
    },
    {
      ...baseApp,
      name: 'dead-rooms',
      args: 'run start',
      env: { NODE_ENV: 'production', PORT: 3330 },
    },
  ],
}
