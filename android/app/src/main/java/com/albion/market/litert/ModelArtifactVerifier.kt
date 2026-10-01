package com.albion.market.litert

import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest

internal object ModelArtifactVerifier {
    private val SHA256_PATTERN = Regex("^[0-9a-f]{64}$")

    fun isVerified(file: File, expectedSize: Long, expectedSha256: String): Boolean = runCatching {
        require(expectedSize > 0) { "Expected model size must be positive" }
        val normalizedHash = normalizeHash(expectedSha256)
        file.isFile && file.length() == expectedSize && sha256(file) == normalizedHash
    }.getOrDefault(false)

    /** Copies an untrusted DownloadManager file into app-private storage, then
     * verifies and atomically promotes only the private copy. */
    fun importAndPromote(
        downloadedFile: File,
        privatePartial: File,
        finalFile: File,
        backupFile: File,
        expectedSize: Long,
        expectedSha256: String,
        deleteSourceOnFailure: Boolean = true,
        promote: (File, File) -> Unit = ::promoteAtomically,
        syncDirectory: (File) -> Unit = ::syncDirectoryMetadata,
    ): Long {
        var imported = false
        try {
            check(downloadedFile.isFile) { "Downloaded model partial is missing" }
            check(expectedSize >= 0L) { "Expected model size must be non-negative" }
            check(downloadedFile.length() == expectedSize) { "Downloaded model size mismatch" }
            check(privatePartial.parentFile?.canonicalFile == finalFile.parentFile?.canonicalFile) {
                "Private partial and final model files must share a directory"
            }
            FileInputStream(downloadedFile).use { input ->
                FileOutputStream(privatePartial, false).use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    var copied = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        check(copied <= expectedSize - count.toLong()) {
                            "Downloaded model exceeded expected size during import"
                        }
                        output.write(buffer, 0, count)
                        copied += count.toLong()
                    }
                    check(copied == expectedSize) { "Downloaded model size changed during import" }
                    output.fd.sync()
                }
            }
            val result = verifyAndPromote(
                privatePartial,
                finalFile,
                backupFile,
                expectedSize,
                expectedSha256,
                promote,
                syncDirectory,
            )
            imported = true
            return result
        } finally {
            if (imported || deleteSourceOnFailure) downloadedFile.delete()
            privatePartial.delete()
        }
    }

    /**
     * Verifies a partial, atomically installs it, and retains the former final as
     * backup until the caller durably commits its state transition.
     */
    fun verifyAndPromote(
        partial: File,
        finalFile: File,
        backupFile: File,
        expectedSize: Long,
        expectedSha256: String,
        promote: (File, File) -> Unit = ::promoteAtomically,
        syncDirectory: (File) -> Unit = ::syncDirectoryMetadata,
    ): Long {
        var backedUp = false
        try {
            require(expectedSize > 0) { "Expected model size must be positive" }
            val parent = finalFile.parentFile?.canonicalFile
            require(partial.parentFile?.canonicalFile == parent && backupFile.parentFile?.canonicalFile == parent) {
                "Partial, final, and backup model files must share a directory"
            }
            val normalizedHash = normalizeHash(expectedSha256)
            check(partial.isFile) { "Downloaded model partial is missing" }
            check(!backupFile.exists()) { "Unresolved model backup already exists" }
            check(partial.length() == expectedSize) {
                "Downloaded model size mismatch: expected $expectedSize, got ${partial.length()}"
            }
            val actualHash = sha256(partial)
            check(actualHash == normalizedHash) {
                "Downloaded model SHA-256 mismatch: expected $normalizedHash, got $actualHash"
            }

            FileOutputStream(partial, true).use { it.fd.sync() }
            if (finalFile.exists()) {
                promote(finalFile, backupFile)
                backedUp = true
                syncDirectory(checkNotNull(parent))
            }
            promote(partial, finalFile)
            syncDirectory(checkNotNull(parent))
            check(finalFile.isFile && finalFile.length() == expectedSize && sha256(finalFile) == normalizedHash) {
                "Promoted model failed final integrity verification"
            }
            return finalFile.length()
        } catch (error: Exception) {
            if (backedUp && backupFile.exists()) {
                runCatching {
                    if (finalFile.exists()) check(finalFile.delete()) { "Could not remove failed promoted model" }
                    promote(backupFile, finalFile)
                    syncDirectory(checkNotNull(finalFile.parentFile))
                }.onFailure(error::addSuppressed)
            }
            throw error
        } finally {
            partial.delete()
        }
    }

    fun restoreBackup(
        finalFile: File,
        backupFile: File,
        promote: (File, File) -> Unit = ::promoteAtomically,
        syncDirectory: (File) -> Unit = ::syncDirectoryMetadata,
    ) {
        if (!backupFile.exists()) return
        if (finalFile.exists()) check(finalFile.delete()) { "Could not remove incomplete promoted model" }
        promote(backupFile, finalFile)
        syncDirectory(checkNotNull(finalFile.parentFile))
    }

    fun discardBackup(backupFile: File, syncDirectory: (File) -> Unit = ::syncDirectoryMetadata) {
        if (backupFile.exists()) check(backupFile.delete()) { "Could not delete committed model backup" }
        syncDirectory(checkNotNull(backupFile.parentFile))
    }

    private fun promoteAtomically(source: File, destination: File) {
        Os.rename(source.absolutePath, destination.absolutePath)
    }

    private fun syncDirectoryMetadata(directory: File) {
        val descriptor = Os.open(directory.absolutePath, OsConstants.O_RDONLY, 0)
        try {
            Os.fsync(descriptor)
        } finally {
            Os.close(descriptor)
        }
    }

    private fun normalizeHash(expectedSha256: String): String {
        val normalized = expectedSha256.lowercase()
        require(SHA256_PATTERN.matches(normalized)) {
            "Expected SHA-256 must contain exactly 64 hexadecimal characters"
        }
        return normalized
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                if (read > 0) digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
