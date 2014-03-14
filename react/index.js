/** @jsx React.DOM */

var IndexComponent = React.createClass({
    getDefaultProps: function () {
        return {
        };
    },
    getInitialState: function () {
        return {
            currentStateVersion: {},
            selectedPodcast: null,
            selectedEpisode: null,
            podcasts: []
        };
    },
    componentWillMount: function () {
        gapi.client.load('appstate', 'v1', function() {
            gapi.client.appstate.states.list({
                includeData: true
            }).execute(function (response) {
                console.log(response);

                var podcastList = _.find(response.items, { stateKey: 0 });
                if (podcastList) {
                    this.state.currentStateVersion[0] = response.currentStateVersion;
                    this.setState({ currentStateVersion: this.state.currentStateVersion });
                    podcastList = JSON.parse(podcastList.data);
                    if (_.isArray(podcastList)) {
                        this.setState({ podcasts: podcastList });
                        this.reloadPodcast();
                    }
                }
            }.bind(this));
        }.bind(this));
    },
    addPodcast: function () {
        var node = this.refs.addPodcastUrl.getDOMNode(),
            url = node.value;

        this.state.podcasts.push({ url: url });
        this.setState({ podcasts: this.state.podcasts });

        this.savePodcastList();

        node.value = '';

        this.reloadPodcast(url);
    },
    deletePodcast: function (podcast) {
        if (confirm('Are you sure you want to remove the "' + podcast.title + '" podcast?')) {
            if (this.state.selectedPodcast === podcast) {
                this.setState({ selectedPodcast: null });
            }
            this.setState({ podcasts: _.without(this.state.podcasts, podcast) });

            this.savePodcastList();
        }

        return false;
    },
    savePodcastList: function () {
        gapi.client.appstate.states.delete({
            stateKey: 0
        }).execute(function (response) {
            console.log(response);
            gapi.client.appstate.states.update({
                stateKey: 0,
                resource: {
                    data: JSON.stringify(_.map(this.state.podcasts, function (podcast) {
                        return {
                            url: podcast.url,
                            positions: podcast.positions,
                            listened: podcast.listened
                        }
                    }, this))
                }
            }).execute(function (response) {
                console.log(response);
            }.bind(this));
        }.bind(this));
    },
    deleteAllData: function () {
        if (confirm('Are you sure you want to delete ALL data?')) {
            this.setState({ podcasts: [] });
            this.savePodcastList();
        }
    },
    reloadPodcast: function (url) {
        var reloadList = _(this.state.podcasts);
        if (url) { 
            reloadList = reloadList.where({ url: url });
        } 

        if (reloadList.value().length === 0) { return; }

        $.getJSON('http://query.yahooapis.com/v1/public/yql', {
            format: 'json',
            q: 'select * from xml where ' + reloadList.map(function (podcast) {
                return 'url = "' + podcast.url + '"';
            }).value().join(' or ')
        })
        .done(function (result) {
            if (result.query.count === 0) {
                alert('Invalid feed URL: ' + reloadList.pluck('url').value().join(', '));
                this.setState({ podcasts: _.without.apply(null, [this.state.podcasts].concat(reloadList.value())) });
                this.savePodcastList();
                return;
            }

            feeds = result.query.count === 1 ? [result.query.results.rss] : result.query.results.rss;
            
            reloadList.forEach(function (podcast, index) {
                var feed = podcast._feed = feeds[index];
                podcast.title = feed.channel.title;
                podcast.image = (_.first(feed.channel.image, 'url') || [{ url: false }])[0].url;
                podcast.episodes = [];
                podcast.positions = podcast.positions || [];
                podcast.listened = podcast.listened || [];
                _.forEach(feed.channel.item, function (episode) {
                    episode = {
                        podcast: podcast,
                        url: episode.content.url,
                        title: episode.title,
                        subtitle: episode.subtitle,
                        pubDate: moment(episode.pubDate, 'ddd, DD MMM YYYY HH:mm:ss ZZ'),
                        duration: moment.duration(episode.duration), 
                    };
                    episode.durationText = _(['days', 'hours', 'minutes', 'seconds']).map(function (unit) {
                        var count = this.get(unit);
                        return count === 0 ? false : count + ' ' + (count === 1 ? unit.slice(0, -1) : unit);
                    }, episode.duration).filter().value().slice(0, 2).join(' ');
                    podcast.episodes.push(episode);
                });

                // this.state.podcasts[podcast.url] = podcast;
                this.setState({ podcasts: this.state.podcasts });
            }, this);
        }.bind(this))
        .fail(function () {
            alert('Invalid feed URL: ' + reloadList.pluck('url').value().join(', '));
            this.setState({ podcasts: _.without.apply(null, [this.state.podcasts].concat(reloadList.value())) });
            this.savePodcastList();
        }.bind(this));
    },
    selectPodcast: function (podcast) {
        this.setState({ selectedPodcast: podcast });
    },
    playEpisode: function (episode) {
        this.saveCurrentTime();

        this.setState({ selectedEpisode: episode });
    },
    togglePauseEpisode: function () {
        var player = this.refs.player.getPlayer().getDOMNode();
        if (player.paused) {
            player.play();
        } else {
            player.pause();
            this.saveCurrentTime();
        }
    },
    toggleListened: function (episode) {
        var without = _.without(episode.podcast.listened, episode.url);

        // not removed from listened array, have to add it instead
        if (without.length === episode.podcast.listened.length) {
            episode.podcast.listened.push(episode.url);
        } else {
            episode.podcast.listened = without;
        }

        this.setState({ podcasts: this.state.podcasts });

        this.savePodcastList();
    },
    saveCurrentTime: function () {
        var player = this.refs.player.getPlayer().getDOMNode();

        if (player.currentTime < 10) { return; }

        var positions = this.state.selectedEpisode.podcast.positions,
            position = _.find(positions, { url: this.state.selectedEpisode.url });

        if (!position) {
            position = { url: this.state.selectedEpisode.url, savedAt: _.now() };
            positions.push(position);
        }

        position.currentTime = player.currentTime;

        this.setState({ selectedEpisode: this.state.selectedEpisode });

        this.savePodcastList();
    },
    render: function () {
        return (
            <div>
                <div className="row">
                    <div className="col-xs-12">
                        <PodcastPlayerComponent ref="player" data={this.state.selectedEpisode} save={this.saveCurrentTime} />
                    </div>
                </div>
                <div className="row">
                    <div className="col-xs-12 col-sm-4">
                        <PodcastListComponent data={this.state.podcasts} select={this.selectPodcast} selectedPodcast={this.state.selectedPodcast} delete={this.deletePodcast} />
                        <p>
                            <div className="input-group">
                                <input type="text" className="form-control" ref="addPodcastUrl" placeholder="Podcast RSS URL" />
                                <span className="input-group-btn">
                                    <button className="btn btn-default" type="button" onClick={this.addPodcast}>Add</button>
                                </span>
                            </div>
                        </p>
                        <p>
                            <button type="button" className="col-xs-12 btn btn-danger" onClick={this.deleteAllData}>
                                <span className="glyphicon glyphicon-trash"></span> Delete All Data
                            </button>
                        </p>
                        <hr className="visible-xs" />
                    </div>
                    <div className="col-xs-12 col-sm-8">
                        <PodcastDisplayComponent data={this.state.selectedPodcast} selectedEpisode={this.state.selectedEpisode} play={this.playEpisode} togglePause={this.togglePauseEpisode} toggleListened={this.toggleListened} />
                    </div>
                </div>
            </div>
        );
    }
});

var PodcastListComponent = React.createClass({
    propTypes: {
        data: React.PropTypes.array.isRequired,
        select: React.PropTypes.func.isRequired,
        delete: React.PropTypes.func.isRequired
    },
    render: function () {
        return (
            <ul className="nav nav-pills">
                {
                    _.map(this.props.data, function (podcast) {
                        if (!podcast) { return; }

                        return (
                            <li className={'col-xs-5 col-sm-12 ' + (this.props.selectedPodcast === podcast ? 'active' : '')} onClick={this.props.select.bind(null, podcast)}>
                                <a className="col-xs-11" href="#">
                                    <img src={podcast.image} className="col-xs-11 col-sm-4" />
                                    <div className="hidden-xs col-sm-7">{podcast.title}</div>
                                </a>
                            </li>
                        );
                    }, this)
                }
            </ul>
        );
    }
});

var PodcastDisplayComponent = React.createClass({
    propTypes: {
        data: React.PropTypes.object,
        play: React.PropTypes.func.isRequired
    },
    getInitialState: function () {
        return {
            showHidden: false
        };
    },
    toggleShowHidden: function () {
        this.setState({ showHidden: !this.state.showHidden });
    },
    render: function () {
        if (!this.props.data) {
            return (
                <div className="jumbotron text-center">
                    <h2>Select a podcast</h2>
                </div>
            );
        }

        return (
            <div className="panel panel-default">
                <div className="panel-heading">
                    <div className="row">
                    <h3 className="panel-title col-xs-12 col-sm-10">
                        {this.props.data.title}
                    </h3>
                    <p className={'col-xs-12 col-sm-2 ' + (this.props.data.listened.length === 0 ? 'hidden' : 'visible')}>
                        <button type="button" className="btn btn-xs btn-default" onClick={this.toggleShowHidden}>{this.state.showHidden ? 'Hide' : 'Show' } Read</button>
                    </p>
                    </div>
                </div>
                <div className="panel-body">
                    <table className="table table-hover">
                        <tbody>
                            {
                                _.map(this.props.data.episodes, function (episode) {
                                    var position = _.find(episode.podcast.positions, { url: episode.url }),
                                        listened = _.contains(this.props.data.listened, episode.url),
                                        date = moment().diff(episode.pubDate, 'days') >= 7 ? episode.pubDate.format('dddd, MMM D, YYYY') : episode.pubDate.format('dddd');

                                    if (position && position.currentTime) {
                                        position = _(['hours', 'minutes', 'seconds']).map(function (unit) {
                                            return ('0' + this.get(unit)).slice(-2);
                                        }, moment.duration(position.currentTime * 1000)).value().join(':');
                                    }

                                    return (
                                        <tr className={(!this.state.showHidden && listened) ? 'hidden' : 'visible'}>
                                            <td>
                                                <div className="col-xs-12 col-sm-3">
                                                    <span title={episode.pubDate.format('LLLL')}>{date}</span><br />
                                                    <small>{episode.durationText}</small>
                                                    <p>
                                                        <button type="button" className={'col-xs-6 col-sm-12 btn btn-success btn-sm ' + (episode !== this.props.selectedEpisode ? 'hidden' : 'visible')} onClick={this.props.togglePause}>
                                                            <span className="glyphicon glyphicon-pause"></span> Playing
                                                        </button>
                                                        <button type="button" className={'col-xs-6 col-sm-12 btn btn-default btn-sm ' + (episode === this.props.selectedEpisode ? 'hidden' : 'visible')} onClick={this.props.play.bind(null, episode)}>
                                                            <span className="glyphicon glyphicon-play"></span> {position || 'Play'}
                                                        </button>
                                                        <button type="button" className={'col-xs-6 col-sm-12 btn btn-sm ' + (listened ? 'btn-info' : 'btn-warning')} onClick={this.props.toggleListened.bind(null, episode)}>
                                                            <span className="glyphicon glyphicon-check"></span> Mark {listened ? 'Unread' : 'Read'}
                                                        </button>
                                                    </p>
                                                </div>
                                                <div className="col-xs-12 col-sm-9">
                                                    <h5>{episode.title}</h5>
                                                    <p><small>{episode.subtitle}</small></p>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                }, this)
                            }
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }
});

var PodcastPlayerComponent = React.createClass({
    getInitialState: function () {
        return {
            currentTime: null
        };
    },
    componentDidMount: function () {
        var player = this.refs.player.getDOMNode();

        $(player).on('durationchange', function () {
            var position = _.find(this.props.data.podcast.positions, { url: this.props.data.url });

            if (position && position.currentTime) {
                player.currentTime = position.currentTime;
            }
        }.bind(this));

        $(player).on('pause', function () {
            this.props.save();
        }.bind(this));
    },
    getPlayer: function () {
        return this.refs.player;
    },
    render: function () {
        var episode = this.props.data || {};
        _.defaults(episode, { title: 'No episode selected', pubDate: moment(0) });

        return (
            <div className="panel panel-default">
                <div className="panel-heading">
                    <h3 className="panel-title">{episode.title}</h3>
                </div>
                <div className="panel-body">
                    <div className={'row ' + (episode.url ? 'visible' : 'hidden')}>
                        <div className="col-xs-12 col-sm-4">
                            <video className="col-xs-12 col-sm-12" autoPlay="true" controls src={episode.url} ref="player">
                                Your browser does not support the video element.
                            </video>
                        </div>
                        <div className="col-xs-12 col-sm-8">
                            <dl className="dl-horizontal">
                                <dt>Date</dt>
                                <dd>
                                    <span title={episode.pubDate.format('LLLL')}>
                                        {episode.pubDate.fromNow()}
                                    </span>
                                </dd>
                                <dt>Duration</dt>
                                <dd>{episode.durationText}</dd>
                                <dt>Description</dt>
                                <dd>{episode.subtitle}</dd>
                            </dl>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
});
