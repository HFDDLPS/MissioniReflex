#!/bin/sh
APP_HOME="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)" || exit 1
if [ -n "${JAVA_HOME:-}" ]; then
  JAVACMD="$JAVA_HOME/bin/java"
else
  JAVACMD="java"
fi
exec "$JAVACMD" "-Dmissionireflex.wrapperHome=$APP_HOME" -classpath "$APP_HOME/gradle/wrapper/gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain "$@"
