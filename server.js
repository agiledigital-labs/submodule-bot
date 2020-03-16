#!/usr/bin/env node

'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const index = require('./index.js');

// Constants
const PORT = 3000;
const HOST = '0.0.0.0';

// App
const app = express();

app.use(bodyParser.json());

app.get('/', (_req, res) => res.status(200).send({ 
  message: 'This is submodule-bot, use /hook path for your Bitbucket webhook' 
}));

app.post('/hook', async (req, res) => {
  try {
    console.log('POST /hook');

    console.log(JSON.stringify(req.body, null, 2));

    const repo = req.body.pullRequest.fromRef.repository;
    
    const bitbucketHost = new URL(req.body.pullRequest.links.self[0].href).host;

    const defaultBranch = await index.fetchDefaultBranch(bitbucketHost, repo);

    const mergeCommit = req.body.pullRequest.properties.mergeCommit;

    const reviewerNames = req.body.pullRequest.reviewers.map(r => ({ user: { name: r.user.name } }));

    console.log('Reviewers for bump PRs', reviewerNames);

    if (defaultBranch.id === req.body.pullRequest.toRef.id) {
      // Triggers the submodule update.
      index.run(bitbucketHost, repo, mergeCommit, reviewerNames);
      return res.status(200).send({ message: 'Successfully scheduled submodule update' });
    } else {
      console.log('Not merging to default branch, ignoring');
      return res.status(200).send({ message: 'Not merging to default branch, ignoring' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).send({ message: 'internal error' });
  }
});

app.listen(PORT, HOST);

console.log(`Running on http://${HOST}:${PORT}`);
