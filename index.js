'use strict';

const axios = require('axios');
const core = require('@actions/core');
const filetype = require('file-type');
const fs = require('fs').promises;
const FormData = require('form-data');
const path = require('path');

const endpoint = 'https://api.directcloud.jp';
const requireEnvs = [
  'DIRECTCLOUDBOX_SERVICE',
  'DIRECTCLOUDBOX_SERVICE_KEY',
  'DIRECTCLOUDBOX_CODE',
  'DIRECTCLOUDBOX_ID',
  'DIRECTCLOUDBOX_PASSWORD',
  'DIRECTCLOUDBOX_NODE',
  'DIRECTCLOUDBOX_FILE_PATH',
];
const tokenPath = '/openapi/jauth/token?lang=eng';
const tokenParams = ['service', 'service_key', 'code', 'id', 'password'];
const uploadPath = '/openapp/v1/files/upload/';
const createNodePath = '/openapp/v1/folders/create/';

async function fetchAccessToken() {
  const data = new FormData();
  tokenParams.forEach((key) => {
    const value = process.env[`DIRECTCLOUDBOX_${key.toUpperCase()}`];
    data.append(key, value);
  });
  const options = {
    headers: { ...data.getHeaders() },
  };

  const response = await axios.post(endpoint + tokenPath, data, options);
  const cookie = response.headers['set-cookie'];
  const { success, access_token } = response.data;
  if (!success) {
    throw new Error(
      'Failed to get access token. Please check your environment variables'
    );
  }

  return { cookie, access_token };
}

async function createNode(cookie, accessToken, node, newNodeName) {
  const data = new FormData();
  data.append('name', newNodeName);
  const options = {
    headers: {
      Cookie: cookie.reduce((acc, cur) => `${acc}; ${cur.split(';')[0]}`, ''),
      access_token: accessToken,
      ...data.getHeaders(),
    },
  };

  const response = await axios.post(
    `${endpoint}${createNodePath}${node}?lang=eng`,
    data,
    options
  );
  const { success, all } = response.data;
  const newNode = response.data.node;
  if (success) {
    core.info(`${newNodeName} is successfully created (id: ${newNode})`);
  } else {
    throw new Error(`Failed to create a new node "${newNodeName}": ${all}`);
  }
  return newNode;
}

async function uploadFiles(cookie, accessToken, node, filePath) {
  let files;
  try {
    files = await fs.readdir(filePath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOTDIR') {
      await uploadFile(cookie, accessToken, node, filePath);
    } else {
      core.warning(`${filePath} could not be uploaded: ${error.message}`);
    }
    return;
  }

  for (const f of files) {
    if (f.isDirectory()) {
      try {
        const newNode = await createNode(cookie, accessToken, node, f.name);
        await uploadFiles(
          cookie,
          accessToken,
          newNode,
          path.join(filePath, f.name)
        );
      } catch (error) {
        // continue uploading other files when dir creation is failed
        core.warning(error.message);
      }
    } else {
      await uploadFiles(cookie, accessToken, node, path.join(filePath, f.name));
    }
  }
}

async function uploadFile(cookie, accessToken, node, filepath) {
  const buffer = await fs.readFile(filepath);
  const ft = await filetype.fromFile(filepath);
  let mime = ft && ft.mime ? ft.mime : 'text/plain';
  const data = new FormData();
  data.append('Filedata', buffer, {
    filename: path.basename(filepath),
    contentType: mime,
  });
  const options = {
    headers: {
      Cookie: cookie.reduce((acc, cur) => `${acc}; ${cur.split(';')[0]}`, ''),
      access_token: accessToken,
      ...data.getHeaders(),
    },
  };

  const response = await axios.post(
    `${endpoint}${uploadPath}${node}?lang=eng`,
    data,
    options
  );
  const { success } = response.data;
  if (success) {
    core.info(`${filepath} is successfully uploaded`);
  } else {
    throw new Error('Failed to upload: ' + filepath);
  }
}

async function run() {
  try {
    const undefinedEnv = [];
    requireEnvs.forEach((env) => {
      if (process.env[env] === undefined || process.env[env] === '') {
        undefinedEnv.push(env);
      }
    });
    if (undefinedEnv.length > 0) {
      throw new Error(
        `Required environment variables are not set: ${undefinedEnv.join(', ')}`
      );
    }

    const { cookie, access_token } = await fetchAccessToken();
    await uploadFiles(
      cookie,
      access_token,
      process.env.DIRECTCLOUDBOX_NODE,
      path.join('./', process.env.DIRECTCLOUDBOX_FILE_PATH)
    );
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
