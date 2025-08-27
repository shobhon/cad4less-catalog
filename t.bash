# from project root
mkdir -p instance
chmod 777 instance   # be permissive to avoid uid/gid surprises
docker compose up -d web
docker compose exec web bash -lc 'ls -ld /app/instance && touch /app/instance/.perm_check && ls -l /app/instance/.perm_check'