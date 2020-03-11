#!/bin/bash

if [ "$1" != "" ] \
    || [ "$GIT_USER_NAME" == "" ] \
    || [ "$GIT_USER_EMAIL" == "" ] \
    || [ "$BITBUCKET_USERNAME" == "" ] \
    || [ "$BITBUCKET_PASSWORD" == "" ]; then
    echo "Runs server.js in a Docker container." >&2
    echo "Updates it if it's already running." >&2
    echo "Optional environment variables:" >&2
    echo " - SUBMODULE_BOT_PRIVATE_KEY_ID" >&2
    echo "Required environment variables:" >&2
    echo " - GIT_USER_NAME" >&2
    echo " - GIT_USER_EMAIL" >&2
    echo " - BITBUCKET_USERNAME" >&2
    echo " - BITBUCKET_PASSWORD" >&2
    echo "No args." >&2
    exit 1
fi

set -x

docker ps -a
docker stop -t 0 submodule-bot
docker rm submodule-bot
docker ps -a

docker image rm ad/submodule-bot
docker build -t ad/submodule-bot .

set +x
if [ "$SUBMODULE_BOT_PRIVATE_KEY_ID" != "" ]; then
    export SUBMODULE_BOT_PRIVATE_KEY="$(gpg --export-secret-keys --armor $SUBMODULE_BOT_PRIVATE_KEY_ID | tr '\n' '_')"
fi

echo + docker run \
    --env "SUBMODULE_BOT_PRIVATE_KEY_ID=[...]" \
    --env "SUBMODULE_BOT_PRIVATE_KEY=[...]" \
    --env "GIT_USER_NAME=$GIT_USER_NAME" \
    --env "GIT_USER_EMAIL=$GIT_USER_EMAIL" \
    --env "BITBUCKET_USERNAME=$BITBUCKET_USERNAME" \
    --env "BITBUCKET_PASSWORD=[...]" \
    --name=submodule-bot \
    -p 49000:3000 \
    -d ad/submodule-bot
docker run \
    --env "SUBMODULE_BOT_PRIVATE_KEY_ID=$SUBMODULE_BOT_PRIVATE_KEY_ID" \
    --env "SUBMODULE_BOT_PRIVATE_KEY=$(echo $SUBMODULE_BOT_PRIVATE_KEY | tr '_' '\n')" \
    --env "GIT_USER_NAME=$GIT_USER_NAME" \
    --env "GIT_USER_EMAIL=$GIT_USER_EMAIL" \
    --env "BITBUCKET_USERNAME=$BITBUCKET_USERNAME" \
    --env "BITBUCKET_PASSWORD=$BITBUCKET_PASSWORD" \
    --name=submodule-bot \
    -p 49000:3000 \
    -d ad/submodule-bot

# TODO: This example doesn't work anymore.
# cat <<EOF
# Try:
#     curl -H 'Content-Type: application/json' --data '{ "refChanges": [ { "refId": "refs/heads/develop" } ] }' localhost:49000/hook
# And then:
#     docker logs submodule-bot -f
# EOF
