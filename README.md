# submodule-bot
Automatically create PR for dependent submodule update.

Currently works for Bitbucket and all repositories under one project only.

The approach is to setup a `Merge` event webhook in the submodule's Bitbucket repository, e.g.
- Repo `A` and `B` are in Bitbucket project `P`
- Repo `A` is a submodule of repo `B`
- Merge event happens in repo `A`
- Bitbucket sends a webhook event to this `submodule-bot` (hosted somewhere, there is a docker build file)
- `submodule-bot` scans the project's repositories for the submodule dependencies in project `P`
- `submodule-bot` creates a PR in repo `B` for repo `A`'s update.

### Start
```
// ENVs required
GIT_USER_NAME
GIT_USER_EMAIL
BITBUCKET_USERNAME
BITBUCKET_PASSWORD
// GPG signing commits for your bot's commit
SUBMODULE_BOT_PRIVATE_KEY_ID 
SUBMODULE_BOT_PRIVATE_KEY

// Install
npm install

// Run
node server.js
```

### Build Docker image with ENVs
```
// Make sure those ENVs are set on the build shell
docker build --build-arg SUBMODULE_BOT_PRIVATE_KEY --build-arg SUBMODULE_BOT_PRIVATE_KEY_ID --build-arg GIT_USER_NAME --build-arg GIT_USER_EMAIL --build-arg BITBUCKET_USERNAME --build-arg BITBUCKET_PASSWORD -t ad/submodule-bot .
```