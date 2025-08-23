#!/bin/sh

# Run migrations using our custom script
echo "Running database migrations..."
npm run db:migrate:prod

# Check if migrations succeeded
if [ $? -eq 0 ]; then
    echo "Migrations completed successfully"
else
    echo "Migration failed!"
    exit 1
fi

# Start the application
echo "Starting application..."
exec node dist/index.js