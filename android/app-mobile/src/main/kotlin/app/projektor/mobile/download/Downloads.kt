package app.projektor.mobile.download

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import app.projektor.core.ProjektorClient
import app.projektor.core.api.models.MediaFile

/** Container name to MIME type, matching the server's CONTAINER_MIME so the file is indexed as video. */
private val CONTAINER_MIME = mapOf(
    "mp4" to "video/mp4",
    "mkv" to "video/x-matroska",
    "webm" to "video/webm",
    "mov" to "video/quicktime",
    "avi" to "video/x-msvideo",
    "ts" to "video/mp2t",
    "wmv" to "video/x-ms-wmv",
    "flv" to "video/x-flv",
    "mpg" to "video/mpeg",
)

/**
 * Saves the original file, byte for byte, to Downloads/Projektor (in a folder per show for episodes).
 * The system DownloadManager does the work, so it keeps going with the app closed, resumes after a
 * dropped connection, and shows progress in the notification shade.
 */
fun downloadFile(context: Context, client: ProjektorClient, file: MediaFile, title: String, folder: String? = null): Long {
    val dir = listOfNotNull("Projektor", folder?.let(::safeName)).joinToString("/")
    val request = DownloadManager.Request(Uri.parse(client.withAccessToken("/api/files/${file.id}/stream")))
        .setTitle(title)
        .setDescription(file.fileName)
        .setMimeType(CONTAINER_MIME[file.container] ?: "application/octet-stream")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "$dir/${safeName(file.fileName)}")
    @Suppress("DEPRECATION") request.allowScanningByMediaScanner()
    return context.getSystemService(DownloadManager::class.java).enqueue(request)
}

/** Strips characters FAT and Android's media provider refuse in a path segment. */
internal fun safeName(name: String): String = name.replace(Regex("""[\\/:*?"<>|\u0000-\u001f]"""), "_").trim().trimStart('.').ifBlank { "download" }
