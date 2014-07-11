var gulp = require('gulp');
var gutil = require('gulp-util');
var streamify = require('gulp-streamify');
var uglify = require('gulp-uglify');
var source = require('vinyl-source-stream');
var watchify = require('watchify');
var browserify = require('browserify');
var reactify = require('reactify');

gulp.task('default', function () {
    var bundler = watchify('./src/main.js', {
        debug : gutil.env.debug
    });

    bundler.transform('reactify')

    bundler.on('update', rebundle)
    bundler.on('time', function (time) {
        gutil.log('Finished Browserifying after', gutil.colors.cyan((time / 1000) + ' s'));
    });

    function rebundle(ids) {
        if (ids) {
            gutil.log('Browserifying for change in:', gutil.colors.magenta(ids));
        }

        return bundler.bundle()
            .on('error', function(e) {
                gutil.log('Browserify Error', e);
            })
            .pipe(source('bundle.js'))
            .pipe(gutil.env.debug ? gutil.noop() : streamify(uglify()))
            .pipe(gulp.dest('./js'))
    }

    return rebundle();
});