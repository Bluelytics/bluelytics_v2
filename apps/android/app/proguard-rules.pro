# R8 rules beyond those the libraries ship. The app uses no reflection of its own: JSON is read as
# a tree (kotlinx.serialization JsonElement), and Firebase brings its own consumer rules.

# Keep line numbers in crash reports from Play Console; the file names are not needed.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
