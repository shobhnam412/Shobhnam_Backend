module.exports = {
  apps: [
    {
      name: 'shobhnam-backend',
      script: 'server.js',
      instances: 1, // Can increase if instance has more cores (e.g., 'max')
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env_development: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
    },
  ],
};
