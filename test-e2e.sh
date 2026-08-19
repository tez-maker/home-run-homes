#!/usr/bin/env bash
# End-to-end smoke test for the listings platform.
# Requires the server running on localhost:3000 with ADMIN_SECRET=test-secret-123
set -u
BASE=http://localhost:3000
JAR=/tmp/hrh-cookies.txt
GUEST_JAR=/tmp/hrh-guest.txt
rm -f "$JAR" "$GUEST_JAR"
PASS=0; FAIL=0

chk() { # chk <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    printf '  PASS  %-52s %s\n' "$1" "$3"; PASS=$((PASS+1))
  else
    printf '  FAIL  %-52s expected=%s got=%s\n' "$1" "$2" "$3"; FAIL=$((FAIL+1))
  fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "=== 1. Page routes ==="
chk "GET /properties (public)"          200 "$(code $BASE/properties)"
chk "GET /listings alias"               200 "$(code $BASE/listings)"
chk "GET /homes alias"                  200 "$(code $BASE/homes)"
chk "GET /favorites (guest -> redirect)" 302 "$(code $BASE/favorites)"
chk "GET /login"                        200 "$(code $BASE/login)"
chk "GET /assets/hrh-listings-v3.css"   200 "$(code $BASE/assets/hrh-listings-v3.css)"
chk "GET /assets/hrh-listings-v3.js"    200 "$(code $BASE/assets/hrh-listings-v3.js)"
chk "GET /thank-you (guest -> login)"   302 "$(code $BASE/thank-you)"

echo "=== 2. Guest is served properties but blocked from favorites ==="
chk "GET /api/properties"               200 "$(code $BASE/api/properties)"
chk "GET /api/favorites (guest)"        401 "$(code -c $GUEST_JAR $BASE/api/favorites)"
chk "POST /api/favorites/add (guest)"   401 "$(code -c $GUEST_JAR -X POST -H 'Content-Type: application/json' -d '{"propertyId":"HRH-006"}' $BASE/api/favorites/add)"
chk "GET /api/admin/favorites (guest)"  403 "$(code $BASE/api/admin/favorites)"

echo "=== 3. Signup ==="
# Unique email per run so the suite is repeatable without wiping users.json
EMAIL="e2e-$(date +%s)@example.com"
SIGNUP=$(curl -s -c "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"fullName\":\"Test Buyer\",\"email\":\"$EMAIL\",\"phone\":\"4055551234\",\"password\":\"secret123\"}" \
  $BASE/api/signup)
echo "  -> $SIGNUP"
chk "signup ok"  "true" "$(echo "$SIGNUP" | grep -q '"ok":true' && echo true || echo false)"
chk "GET /favorites (logged in)" 200 "$(code -b $JAR $BASE/favorites)"
chk "GET /thank-you (logged in -> 301)" 301 "$(code -b $JAR $BASE/thank-you)"
chk "GET /login (logged in -> redirect)" 302 "$(code -b $JAR $BASE/login)"

echo "=== 4. Add favorites ==="
for PID in HRH-006 HRH-041 HRH-117; do
  R=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' \
      -d "{\"propertyId\":\"$PID\"}" $BASE/api/favorites/add)
  chk "add $PID" "true" "$(echo "$R" | grep -q "$PID" && echo true || echo false)"
done
chk "add duplicate is idempotent" 1 \
  "$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"propertyId":"HRH-006"}' \
     $BASE/api/favorites/add | grep -o 'HRH-006' | wc -l)"
chk "reject bogus property id" 400 \
  "$(code -b $JAR -X POST -H 'Content-Type: application/json' -d '{"propertyId":"NOT-REAL"}' $BASE/api/favorites/add)"
chk "reject empty body" 400 \
  "$(code -b $JAR -X POST -H 'Content-Type: application/json' -d '{}' $BASE/api/favorites/add)"

echo "=== 5. Read + remove ==="
GET=$(curl -s -b "$JAR" $BASE/api/favorites)
echo "  -> $GET"
chk "3 favorites stored" 3 "$(echo "$GET" | grep -o 'HRH-' | wc -l)"
curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"propertyId":"HRH-041"}' $BASE/api/favorites/remove > /dev/null
AFTER=$(curl -s -b "$JAR" $BASE/api/favorites)
chk "2 favorites after removal" 2 "$(echo "$AFTER" | grep -o 'HRH-' | wc -l)"
chk "removed id is gone" "false" "$(echo "$AFTER" | grep -q 'HRH-041' && echo true || echo false)"

echo "=== 6. Persistence across restart (favorites.json on disk) ==="
chk "favorites.json exists" "true" "$([ -f /home/ubuntu/hrh/favorites.json ] && echo true || echo false)"
echo "  file: $(cat /home/ubuntu/hrh/favorites.json | tr -d '\n')"

echo "=== 7. Admin endpoint ==="
chk "admin via secret header" 200 "$(code -H 'x-admin-secret: test-secret-123' $BASE/api/admin/favorites)"
chk "admin wrong secret" 403 "$(code -H 'x-admin-secret: nope' $BASE/api/admin/favorites)"
chk "admin as normal user" 403 "$(code -b $JAR $BASE/api/admin/favorites)"
echo "  --- admin payload ---"
curl -s -H 'x-admin-secret: test-secret-123' $BASE/api/admin/favorites | python3 -m json.tool

echo "=== 8. Session persistence (new request, same cookie) ==="
chk "favorites survive new request" 2 "$(curl -s -b $JAR $BASE/api/favorites | grep -o 'HRH-' | wc -l)"

echo
echo "==================== $PASS passed, $FAIL failed ===================="
[ "$FAIL" -eq 0 ]
