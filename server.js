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

app.post('/hook', (req, res) => {
  console.log('POST /hook');
  console.log('Body:');
  console.log(JSON.stringify(req.body, null, 4));

  const refChanges = req.body.refChanges;

  if (!refChanges) {
    console.warn("No 'refChanges' field in POST body.");
    res.status(400);
    res.send('Bad request');
    return;
  }

  // TODO: Don't assume 'develop' is the default branch.
  if (refChanges.filter(ref => ref.refId === 'refs/heads/develop').length > 0) {
    index.createSubmodulePRs();
    res.send('OK');
  } else {
    res.send('Not develop branch. Ignoring.');
  }
});

app.listen(PORT, HOST);
console.log(`Running on http://${HOST}:${PORT}`);
