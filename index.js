const fs = require('fs-extra');
const gpg = require('gpg');

const workingDirPath = './repos';

// if (fs.existsSync(workingDirPath)) {
//   console.log(`Cleaning working directory [${workingDirPath}]`);
//   fs.removeSync(workingDirPath);
// }

if (!fs.existsSync(workingDirPath)){
  console.log(`Creating temp working directory [${workingDirPath}]`);
  fs.mkdirSync(workingDirPath, { recursive: true });
}

const simpleGit = require('simple-git/promise');
const git = simpleGit(workingDirPath);
const axios = require('axios');

const bitbucketUsername = process.env.BITBUCKET_USERNAME;
const bitbucketPassword = process.env.BITBUCKET_PASSWORD;

const run = async () => {
  const response = await axios.get('https://stash.agiledigital.com.au/rest/api/latest/projects/CSC/repos?limit=1000', {
    auth: {
      username: bitbucketUsername,
      password: bitbucketPassword
    }
  });

  const repos = response.data.values;

  repos.map(async repo => {
    const repoDir = `${workingDirPath}/${repo.name}`;

    const httpCloneUrl = repo.links.clone.find(link => link.name === 'http').href;

    const host = httpCloneUrl.split('://')[1];
  
    const cloneUrlWithCred = `https://${bitbucketUsername}:${encodeURIComponent(bitbucketPassword)}@${host}`;
  
    const repoDirExist = fs.existsSync(repoDir);

    if (!repoDirExist){
      console.log(`Cloning [${repo.name}]...`);
      await git.clone(cloneUrlWithCred);
      console.log(`Done [${repo.name}]`);
    }

    await git.cwd(repoDir);

    await git.subModule([
      'update',
      '--init',
      '--recursive'
    ]);

    const submodules = await git.raw([
      'config',
      '--file',
      '.gitmodules',
      '--name-only',
      '--get-regexp',
      'path'
    ]);

    
    console.log(submodules);

    return 'Done';
  });


};

exports.createSubmodulePRs = () => {
  // Import the signing key.
  gpg.importKey(process.env.SUBMODULE_BOT_PRIVATE_KEY, [], (success, err) => {
    if (err) {
      console.error(err);
      return;
    }

    run();
  });
};


