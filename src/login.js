/** @jsx React.DOM */

var React = require('react')

var LoginComponent = React.createClass({
    propTypes: {
        dropboxClient: React.PropTypes.instanceOf(Dropbox.Client).isRequired,
        loadingComponent: React.PropTypes.component.isRequired,
    },
    getDefaultProps: function () {
        return {
        };
    },
    getInitialState: function () {
        return {
        };
    },
    login: function () {
        this.props.loadingComponent.start();

        this.props.dropboxClient.authenticate(null, function (error, client) {
            this.props.loadingComponent.stop();

            if (!error && client.isAuthenticated()) {
                showIndex();
            }
        }.bind(this));

        return false;
    },
    render: function () {
        return (
            <div className="jumbotron text-center">
                <button type="button" className="btn btn-primary" onClick={this.login}>Login with Dropbox</button>
            </div>
        );
    }
});

module.exports = LoginComponent;