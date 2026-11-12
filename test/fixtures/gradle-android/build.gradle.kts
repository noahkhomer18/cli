plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
    id("org.jetbrains.kotlin.kapt")
}

android {
    namespace = "com.example.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
        }
    }

    flavorDimensions += "tier"
    productFlavors {
        create("free") {}
    }
}

dependencies {
    // The test declaration comes first. The production row replaces it.
    androidTestImplementation("com.example:shared:9.9.9")
    implementation("com.example:shared:1.2.3")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    debugImplementation("com.example:debug-lib:1.0.0")
    releaseImplementation("com.example:release-lib:1.0.0")
    freeImplementation("com.example:free-lib:1.0.0")
    releaseApi("com.example:release-api:1.0.0")
    debugCompileOnly("com.example:debug-compile-only:1.0.0")
    releaseRuntimeOnly("com.example:release-runtime:1.0.0")
    testFixturesImplementation("com.example:fixtures-impl:1.0.0")
    testFixturesApi("com.example:fixtures-api:1.0.0")
    ksp("com.google.dagger:hilt-compiler:2.52")
    kaptTest("com.example:kapt-test:1.0.0")
    kaptAndroidTest("com.example:kapt-android-test:1.0.0")
    kspTest("com.example:ksp-test:1.0.0")
    developmentOnly("com.example:dev-only:1.0.0")
    compileOnlyApi("com.example:compile-only-api:1.0.0")
    // A longer identifier that merely contains a configuration name is not a row.
    notimplementation("com.example:not-a-dep:1.0.0")
    smoke("com.example:smoke:1.0.0")
    compile("com.example:legacy:1.0.0")
}
