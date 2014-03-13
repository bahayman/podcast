/** @jsx React.DOM */

var LoginComponent = React.createClass({
    getDefaultProps: function () {
        return {
        };
    },
    getInitialState: function () {
        return {
        };
    },
    login: function () {
        gapi.auth.authorize({client_id: clientId, scope: scopes, immediate: false}, function (authResult) {
            if (authResult && !authResult.error) {
                showIndex();
            }
        });

        return false;
    },
    render: function () {
        return (
            <div className="jumbotron text-center">
                <button type="button" className="btn btn-primary" onClick={this.login}>Login with Google</button>
            </div>
        );
    }
});