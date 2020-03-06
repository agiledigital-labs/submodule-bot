#!/bin/bash

if [ "$1" != "" ] \
    || [ "$SUBMODULE_BOT_PRIVATE_KEY_ID" == "" ] \
    || [ "$BITBUCKET_USERNAME" == "" ] \
    || [ "$BITBUCKET_PASSWORD" == "" ]; then
    echo "Runs server.js in a Docker container." >&2
    echo "Updates it if it's already running." >&2
    echo "Required environment variables:" >&2
    echo " - SUBMODULE_BOT_PRIVATE_KEY_ID" >&2
    echo " - BITBUCKET_USERNAME" >&2
    echo " - BITBUCKET_PASSWORD" >&2
    echo "No args." >&2
    exit 1
fi

set -x

sudo docker ps -a
sudo docker stop -t 0 submodule-bot
sudo docker rm submodule-bot
sudo docker ps -a

sudo docker image rm ad/submodule-bot
sudo docker build -t ad/submodule-bot .

set +x
export SUBMODULE_BOT_PRIVATE_KEY="$(gpg --export-secret-keys --armor $SUBMODULE_BOT_PRIVATE_KEY_ID | tr '\n' '_')"
echo + sudo docker run \
    --env "SUBMODULE_BOT_PRIVATE_KEY=[...]" \
    --env "BITBUCKET_USERNAME=[...]" \
    --env "BITBUCKET_PASSWORD=[...]" \
    --name=submodule-bot \
    -p 49000:8080 \
    -d ad/submodule-bot
sudo docker run \
    --env "SUBMODULE_BOT_PRIVATE_KEY=$(echo $SUBMODULE_BOT_PRIVATE_KEY | tr '_' '\n')" \
    --env "BITBUCKET_USERNAME=$BITBUCKET_USERNAME" \
    --env "BITBUCKET_PASSWORD=$BITBUCKET_PASSWORD" \
    --name=submodule-bot \
    -p 49000:8080 \
    -d ad/submodule-bot

cat <<EOF
Try:
    curl -H 'Content-Type: application/json' --data '{ "refChanges": [ { "refId": "refs/heads/develop" } ] }' localhost:49000/hook
And then:
    docker logs submodule-bot
EOF
