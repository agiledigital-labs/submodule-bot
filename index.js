'use strict';

const fs = require('fs-extra');

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

const createPullRequest = async (bitbucketHost, repo, branchName, defaultBranch, submoduleRepo) => {
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

const processRepo = async (bitbucketHost, repo, submoduleCommit, submoduleRepo) => {
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

  const submoduleConfigs = await git.raw(['config', '--file', '.gitmodules', '--get-regexp', 'path']);

  console.log(submoduleConfigs);

  if (submoduleConfigs) {
    const submodulePath = submoduleConfigs.split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const [_, path] = line.split(' ');
        return { path }
      });

    const submodules = await git.subModule(['status']);

    const submoduleCommits = submodules.split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const [_, commit, path] = line.split(' ');
        return { commit, path };
      });

    const submodulePathToUpdate = submodulePath.find(subPath => { 
      const pathParts = subPath.path.split('/');
      const folderName = pathParts[pathParts.length - 1];
      const folderNameRegex = new RegExp(folderName, 'g');
      const match = submoduleRepo.name.match(folderNameRegex);
      return match && match.length > 0;
    });

    if (submodulePathToUpdate) {
      const submoduleToUpdate = submoduleCommits.find(sub => submodulePathToUpdate.path.indexOf(sub.path) > -1);

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

        const prResponse = await createPullRequest(bitbucketHost, repo, branchName, defaultBranch, submoduleRepo);

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

const run = async (bitbucketHost, submoduleRepo, mergeCommit) => {
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

      const result = await processRepo(bitbucketHost, repo, submoduleCommit, submoduleRepo);
      
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
