# hub-codeserver

`hub-codeserver` is like [jupyterhub](https://github.com/jupyterhub/jupyterhub) but for [VS Code](https://github.com/Microsoft/vscode), based on [code-server](https://github.com/codercom/code-server) and [rafket/vscode-hub](https://github.com/rafket/vscode-hub/).

## Running vscode-hub

1. Start the docker daemon: `systemctl start docker`
2. Install node dependencies: `npm install`
3. Fill in the information in `config.json`
    - Allowed user IDs in `ralist`
    - Image names for corresponding IDs in `user_image`
    - Google ClientID for Oauth in `google_clientid`
    - Google Client Secret for Oauth in `google_clientsecret`
4. Run the server: `node index.js`
5. Visit `localhost:83`

## Settings

* `ralist`: List of RAs user that are allowed to log in (based on email prefix)
* `port`: Port that the service will run on.
* `images`: Dictionary of supported Docker images.
    - `port`: Port that the web service runs on in the container.
    - `path`: Path to the folder containing the Dockerfile.
    - `max_memory`: Maximum memory in bytes allowed to the container.
    - `disk_quota`: Maximum disk space in bytes allowed to the container.
* `user_image`: Dictionary of user IDs to chosen images.
* `callback_url`: Callback URL for Google Oauth.
* `time_out`: Time (in ms) after which an inactive container is killed.
* `google_clientid`: Google ClientID for Oauth.
* `google_clientsecret`: Google Client Secret for Oauth.
