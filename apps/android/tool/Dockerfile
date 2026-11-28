# The build environment of tool/build.sh: a JDK Gradle accepts and the Android SDK packages the
# project compiles against. Built once by tool/build.sh and cached by Docker.
FROM eclipse-temurin:21-jdk-noble

ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip \
 && rm -rf /var/lib/apt/lists/*

# Command-line tools 20.0 (https://developer.android.com/studio#command-line-tools-only).
RUN curl -fsSL -o /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip \
 && mkdir -p $ANDROID_HOME/cmdline-tools \
 && unzip -q /tmp/tools.zip -d $ANDROID_HOME/cmdline-tools \
 && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
 && rm /tmp/tools.zip

# Keep in step with compileSdk in app/build.gradle.kts and the build tools AGP defaults to.
RUN yes | sdkmanager --licenses > /dev/null \
 && sdkmanager --install "platforms;android-37.2" "build-tools;36.0.0" "platform-tools" > /dev/null \
 && chmod -R a+rX $ANDROID_HOME
