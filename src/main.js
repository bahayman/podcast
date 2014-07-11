/** @jsx React.DOM */

var React = require('react');
var LoadingComponent = require('./loading.js');
var LoginComponent = require('./login.js');
var IndexComponent = require('./index.js');

var dropboxClient = new Dropbox.Client({key: 'a9edvhr31f7y0xp'}),
    loadingComponent = React.renderComponent(<LoadingComponent />, document.getElementById('loading'));

dropboxClient.authenticate({ interactive: false }, function (error, client) {
    if (!error && client.isAuthenticated()) {
        showIndex();
    } else {
        showLogin();

        if (error) {
            alert('Authentication error: ' + error);
        }
    }
});

function showIndex() {
    React.renderComponent(
        <IndexComponent dropboxClient={dropboxClient} loadingComponent={loadingComponent} />,
        document.getElementById('container')
    );
}

function showLogin() {
    React.renderComponent(
        <LoginComponent dropboxClient={dropboxClient} loadingComponent={loadingComponent} />,
        document.getElementById('container')
    );
}
