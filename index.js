const fs = require('fs-extra');
const gpg = require('gpg');

const workingDirPath = './repos';

if (!fs.existsSync(workingDirPath)) {
  console.log(`Creating temp working directory [${workingDirPath}]`);
  fs.mkdirSync(workingDirPath, { recursive: true });
}

const simpleGit = require('simple-git/promise');
const git = simpleGit(workingDirPath);
const axios = require('axios');

const gitUserName = process.env.GIT_USER_NAME;
const gitUserEmail = process.env.GIT_USER_EMAIL;
const bitbucketUsername = process.env.BITBUCKET_USERNAME;
const bitbucketPassword = process.env.BITBUCKET_PASSWORD;

const signingKeyId = process.env.SUBMODULE_BOT_PRIVATE_KEY_ID;

// TODO: These should come from webhook call.
const updatedRepo = 'canonical-model-api-raml';
const updatedCommit = '7b5a6f1eb0f45110ad8511043d37684d5d687f6a';
const project = 'CSC';

const fetchDefaultBranch = async (repo) => {
  const response = await axios.get(`https://stash.agiledigital.com.au/rest/api/latest/projects/${project}/repos/${repo.name}/branches/default`, {
    auth: {
      username: bitbucketUsername,
      password: bitbucketPassword
    }
  });

  return response.data;
};

const fetchRepos = async () => {
  const response = await axios.get(`https://stash.agiledigital.com.au/rest/api/latest/projects/${project}/repos?limit=1000`, {
    auth: {
      username: bitbucketUsername,
      password: bitbucketPassword
    }
  });

  return response.data;
};

const fetchCommit = async (commitId, repoName) => {
  const response = await axios.get(`https://stash.agiledigital.com.au/rest/api/latest/projects/${project}/repos/${repoName}/commits/${commitId}`, {
    auth: {
      username: bitbucketUsername,
      password: bitbucketPassword
    }
  });

  return response.data;
};

const createPullRequest = async (repo, branchName, defaultBranch, submoduleRepo) => {
  const response = await axios.post(`https://stash.agiledigital.com.au/rest/api/latest/projects/CSC/repos/${repo.name}/pull-requests`,
    {
      title: `Bump ${submoduleRepo} version`,
      description: `Auto PR for bumping ${submoduleRepo} version`,
      state: 'OPEN',
      open: true,
      closed: false,
      fromRef: {
        id: `refs/heads/${branchName}`,
        repository: {
          'slug': repo.name,
          'project': {
            'key': project
          }
        }
      },
      toRef: {
        id: defaultBranch.id,
        repository: {
          'slug': repo.name,
          'project': {
            'key': project
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

const processRepo = async (repo, submoduleCommit) => {
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

  const defaultBranch = await fetchDefaultBranch(repo);

  await git.cwd(repoDir);

  await git.pull(`origin/${defaultBranch.displayId}`);

  // Init submodules so we can have working module directory.
  await git.submoduleUpdate(['--init', '--recursive']);

  const submoduleConfigs = await git.raw(['config', '--file', '.gitmodules', '--get-regexp', 'url']);

  if (submoduleConfigs) {
    const submodulePath = submoduleConfigs.split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const [pathUrl, rawName] = line.split(' ');
        return { pathUrl, rawName }
      });

    const submodules = await git.subModule(['status']);

    const submoduleCommits = submodules.split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const [_, commit, path] = line.split(' ');
        return { commit, path };
      });

    const submodulePathToUpdate = submodulePath.find(subPath => subPath.rawName.indexOf(updatedRepo) > -1);

    if (submodulePathToUpdate) {
      const submoduleToUpdate = submoduleCommits.find(sub => submodulePathToUpdate.pathUrl.indexOf(sub.path) > -1);

      console.log('Submodule to update', submoduleToUpdate);

      if (submoduleToUpdate.commit !== updatedCommit) {
        console.log(`Submodule is behind, updating to [${updatedCommit}]`);

        const jiraTicket = submoduleCommit.properties['jira-key'].find(key => key.indexOf(project) > -1) || 'XXX';

        const branchName = `feature/${jiraTicket}-bump-${updatedRepo}`;

        await git.cwd(`${repoDir}/${submoduleToUpdate.path}`);

        await git.checkout(updatedCommit);

        await git.cwd(repoDir);

        await git.add('.');

        await git.addConfig('user.name', gitUserName);
        await git.addConfig('user.email', gitUserEmail);

        await git.raw(['commit', `--gpg-sign=${signingKeyId}`, '-am', `${jiraTicket} = ${repo.name}: Bump ${updatedRepo}`]);

        await git.push(['origin', `HEAD:${branchName}`]);

        const prResponse = await createPullRequest(repo, branchName, defaultBranch, updatedRepo);

        console.log(`PR created [${JSON.stringify(prResponse, null, 2)}]`);
      }
      else {
        console.log(`Submodule [${updatedRepo}] is update to date`);
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

const run = async () => {
  const data = await fetchRepos();

  const repos = data.values;

  console.log(`Scanning [${repos.length}] repos....`);

  const submoduleCommit = await fetchCommit(updatedCommit, updatedRepo);

  await repos.reduce(async (res, repo) => {
    // Wait for previous working finished in order to not confuse SimpleGit's session.
    await res;
    
    const result = await processRepo(repo, submoduleCommit);
    
    console.log('\n');

    return result;
  }, Promise.resolve(''));

  console.log('Successfully scanned repos and updated correspondence submodules');
};

exports.createSubmodulePRs = () => {
  console.log('Importing signing private key');

  gpg.importKey(process.env.SUBMODULE_BOT_PRIVATE_KEY, [], (success, err) => {
    console.error(err);
    run();
  });
};


