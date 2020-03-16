'use strict';

const fs = require('fs-extra');
const { zip, isEmpty } = require('lodash');

const workingDirPath = './repos';

if (!fs.existsSync(workingDirPath)) {
  console.log(`Creating temp working directory [${workingDirPath}]`);
  fs.mkdirSync(workingDirPath, { recursive: true });
}

const simpleGit = require('simple-git/promise');
const git = simpleGit(workingDirPath);
const axios = require('axios');
const gpg = require('gpg');

const gitUserName = process.env.GIT_USER_NAME;
const gitUserEmail = process.env.GIT_USER_EMAIL;
const bitbucketUsername = process.env.BITBUCKET_USERNAME;
const bitbucketPassword = process.env.BITBUCKET_PASSWORD;
const signingKeyId = process.env.SUBMODULE_BOT_PRIVATE_KEY_ID;

const fetchDefaultBranch = async (bitbucketHost, repo) => {
  const response = await axios.get(`https://${bitbucketHost}/rest/api/latest/projects/${repo.project.key}/repos/${repo.name}/branches/default`, {
    auth: {
      username: bitbucketUsername,
      password: bitbucketPassword
    }
  });

  return response.data;
};

const fetchRepos = async (bitbucketHost, repo) => {
  const response = await axios.get(`https://${bitbucketHost}/rest/api/latest/projects/${repo.project.key}/repos?limit=1000`, {
    auth: {
      username: bitbucketUsername,
      password: bitbucketPassword
    }
  });

  return response.data;
};

const fetchCommit = async (bitbucketHost, commit, repo) => {
  const response = await axios.get(`https://${bitbucketHost}/rest/api/latest/projects/${repo.project.key}/repos/${repo.name}/commits/${commit.id}`, {
    auth: {
      username: bitbucketUsername,
      password: bitbucketPassword
    }
  });

  return response.data;
};

const createPullRequest = async (bitbucketHost, repo, branchName, defaultBranch, submoduleRepo, reviewerNames) => {
  const response = await axios.post(`https://${bitbucketHost}/rest/api/latest/projects/${repo.project.key}/repos/${repo.name}/pull-requests`,
    {
      title: `Bump ${submoduleRepo.name} version`,
      description: `Auto PR for bumping ${submoduleRepo.name} version`,
      state: 'OPEN',
      open: true,
      closed: false,
      fromRef: {
        id: `refs/heads/${branchName}`,
        repository: {
          'slug': repo.name,
          'project': {
            'key': repo.project.key
          }
        }
      },
      reviewers: reviewerNames,
      toRef: {
        id: defaultBranch.id,
        repository: {
          'slug': repo.name,
          'project': {
            'key': repo.project.key
          }
        }
      },
      'locked': false
    }, {
    auth: {
      username: bitbucketUsername,
      password: bitbucketPassword
    }
  });

  return response.data;
};

const processRepo = async (bitbucketHost, repo, submoduleCommit, submoduleRepo, reviewerNames) => {
  console.log(`Working on [${repo.name}]...`);
  
  // Reset working directory.
  await git.cwd(workingDirPath);
    
  const repoDir = `${workingDirPath}/${repo.name}`;

  const httpCloneUrl = repo.links.clone.find(link => link.name === 'http').href;

  const host = httpCloneUrl.split('://')[1];

  const cloneUrlWithCred = `https://${bitbucketUsername}:${encodeURIComponent(bitbucketPassword)}@${host}`;

  const repoDirExist = fs.existsSync(repoDir);

  if (!repoDirExist) {
    console.log(`Cloning [${repo.name}]...`);
    await git.clone(cloneUrlWithCred);
    console.log(`Done [${repo.name}]`);
  }

  const defaultBranch = await fetchDefaultBranch(bitbucketHost, repo);

  await git.cwd(repoDir);

  await git.pull(`origin/${defaultBranch.displayId}`);

  // Init submodules so we can have working module directory.
  await git.submoduleUpdate(['--init', '--recursive']);

  const submoduleUrlConfigs = await git.raw(['config', '--file', '.gitmodules', '--get-regexp', 'url']);

  console.log('Submodule URL configs');
  console.log(submoduleUrlConfigs);

  const submodulePathConfigs = await git.raw(['config', '--file', '.gitmodules', '--get-regexp', 'path']);

  console.log('Submodule Path configs');
  console.log(submodulePathConfigs);

  if (submoduleUrlConfigs && submodulePathConfigs) {
    const subUrlConfigs = submoduleUrlConfigs.split('\n');
    const subPathConfigs = submodulePathConfigs.split('\n');

    const subConfigs = zip(subUrlConfigs, subPathConfigs).filter(([u, p]) => !isEmpty(u) && !isEmpty(p));

    console.log('Submodule configs', subConfigs);

    const submoduleRepos = subConfigs
      .map(([urlConfig, pathConfig]) => {
        const [_, repoUrl] = urlConfig.split(' ');
        const [__, path] = pathConfig.split(' ');
        return { repoUrl, path }
      });


    console.log('Submodule repos', submoduleRepos);

    const submoduleUrlToUpdate = submoduleRepos.find(repo => { 
      const urlParts = repo.repoUrl.split('/');
      const repoName = urlParts[urlParts.length - 1];
      const subRepoRegex = new RegExp(submoduleRepo.name, 'g');
      const match = repoName.match(subRepoRegex);
      return match && match.length > 0;
    });

    console.log('Submodule URL to update', submoduleUrlToUpdate);
    console.log(`Submodule Repo Name [${submoduleRepo.name}]`);

    const submodules = await git.subModule(['status']);

    const submoduleCommits = submodules.split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const [_, commit, path] = line.split(' ');
        return { commit, path };
      });

    if (submoduleUrlToUpdate) {
      console.log('Submodule commits', submoduleCommits);

      const submoduleToUpdate = submoduleCommits.find(sub => submoduleUrlToUpdate.path.indexOf(sub.path) > -1);

      console.log('Submodule to update', submoduleToUpdate);

      if (submoduleToUpdate.commit !== submoduleCommit.id) {
        console.log(`Submodule is behind, updating to [${submoduleCommit.id}]`);

        const jiraTicket = submoduleCommit.properties['jira-key'].find(key => key.indexOf(submoduleRepo.project.key) > -1) || 'XXX';

        const branchName = `feature/${jiraTicket}-bump-${submoduleRepo.name}`;

        await git.cwd(`${repoDir}/${submoduleToUpdate.path}`);

        await git.fetch();

        await git.checkout(submoduleCommit.id);

        await git.cwd(repoDir);

        await git.add('.');
        
        await git.addConfig('user.name', gitUserName);

        await git.addConfig('user.email', gitUserEmail);

        if (signingKeyId) {
          await git.raw(['commit', `--gpg-sign=${signingKeyId}`, '-am', `${jiraTicket} = ${repo.name}: [submodule-bot] bump ${submoduleRepo.name}`]);
        }
        else {
          await git.raw(['commit', '-am', `${jiraTicket} = ${repo.name}: [submodule-bot] bump ${submoduleRepo.name}`]);
        }

        await git.push(['origin', `HEAD:${branchName}`]);

        const prResponse = await createPullRequest(bitbucketHost, repo, branchName, defaultBranch, submoduleRepo, reviewerNames);

        console.log(`PR created [${JSON.stringify(prResponse, null, 2)}]`);
      }
      else {
        console.log(`Submodule [${submoduleRepo.name}] is update to date`);
      }
    }
    else {
      console.log('No submodule to update');
    }
  }
  else {
    console.log(`No submodule for [${repo.name}]`);
  }

  return 'Done';
}

const run = async (bitbucketHost, submoduleRepo, mergeCommit, reviewerNames) => {
  const data = await fetchRepos(bitbucketHost, submoduleRepo);

  const repos = data.values;

  console.log('Importing signing private key');

  gpg.importKey(process.env.SUBMODULE_BOT_PRIVATE_KEY, [], async (err, _) => {
    if (err) {
      console.error(err);
      console.log('Ignore GPG signing for bot user');
    }

    console.log(`Scanning [${repos.length}] repos....`);

    const submoduleCommit = await fetchCommit(bitbucketHost, mergeCommit, submoduleRepo);

    await repos.reduce(async (res, repo) => {
      // Wait for previous working finished in order to not confuse SimpleGit's session.
      await res;

      const result = await processRepo(bitbucketHost, repo, submoduleCommit, submoduleRepo, reviewerNames);
      
      console.log('\n');

      return result;
    }, Promise.resolve(''));

    console.log('Successfully scanned repos and updated submodules');
  });
};

module.exports = {
  fetchDefaultBranch,
  run
};
