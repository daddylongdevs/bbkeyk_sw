#!/bin/sh

if [ -z "$1" ]; then
  echo "Usage: $0 <container_id_or_name>"
  exit 1
fi
CONTAINER=$1

echo "\n--- Checking nginx process ---"
docker exec -it $CONTAINER ps aux | grep nginx | grep -v grep

echo "\n--- Checking Vite processes ---"
docker exec -it $CONTAINER ps aux | grep vite | grep -v grep

echo "\n--- Nginx games.conf ---"
docker exec -it $CONTAINER cat /etc/nginx/conf.d/games.conf

echo "\n--- Testing Vite dev server for kobi_ass (port 3001) ---"
docker exec -it $CONTAINER wget -qO- http://127.0.0.1:3001/ || echo "Failed to connect to kobi_ass dev server"

echo "\n--- Testing Vite dev server for sugar_wonderland (port 3002) ---"
docker exec -it $CONTAINER wget -qO- http://127.0.0.1:3002/ || echo "Failed to connect to sugar_wonderland dev server"

echo "\n--- Done ---" 