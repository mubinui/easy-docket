import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

/**
 * Handing a file to the user.
 *
 * The two platforms need genuinely different mechanisms, which is why this is a
 * service rather than three lines at the call site. In a browser, an object URL
 * and a synthetic click is the only route. Inside the Android WebView that path
 * is inert — downloads started by page script are blocked — so the file is
 * written to the app's cache and passed to the system share sheet, which is
 * also what an Android user expects: they choose where it goes.
 *
 * Capacitor's plugins are imported lazily so the web build never carries the
 * native shims for a code path it cannot reach.
 */
@Injectable({ providedIn: 'root' })
export class FileExportService {
  async exportText(filename: string, contents: string, mimeType = 'text/csv'): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await this.shareFromCache(filename, contents);
      return;
    }
    this.downloadInBrowser(filename, contents, mimeType);
  }

  private downloadInBrowser(filename: string, contents: string, mimeType: string): void {
    // The BOM makes Excel open UTF-8 as UTF-8 rather than as the local codepage,
    // which is the difference between "Café" and "CafÃ©" in the user's spreadsheet.
    const blob = new Blob([`﻿${contents}`], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();

    // Revoking immediately can cancel the download in some browsers; a turn of
    // the event loop is enough for the request to have been made.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private async shareFromCache(filename: string, contents: string): Promise<void> {
    const [{ Directory, Encoding, Filesystem }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);

    // The cache directory, not documents: this is a handoff, not storage the
    // app is responsible for keeping.
    const written = await Filesystem.writeFile({
      path: filename,
      data: contents,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });

    await Share.share({
      title: filename,
      url: written.uri,
      dialogTitle: 'Export',
    });
  }
}
