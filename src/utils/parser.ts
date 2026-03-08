import { Clipping } from '../types';

export function parseClippings(fileContent: string): Clipping[] {
  // Split by the separator
  const entries = fileContent.split('==========').filter((entry) => entry.trim().length > 0);
  const clippings: Clipping[] = [];

  entries.forEach((entry) => {
    // Split into lines and remove empty ones to handle variable spacing
    const lines = entry.trim().split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // We need at least 2 lines: Title/Author and Metadata (Content might be empty but usually isn't)
    if (lines.length < 2) return;

    // 1. Identify the Title/Author line (usually the first non-empty line)
    const titleLine = lines[0];
    let bookTitle = titleLine;
    let author = 'Unknown Author';

    // Try to extract author from the last set of parentheses
    // Matches: "Title (Author)" or "Title (Author) (Translator)"
    // We take the content of the *last* parenthesis as the author/meta
    const authorMatch = titleLine.match(/(.*)\s+\(([^)]+)\)$/);
    if (authorMatch) {
      bookTitle = authorMatch[1].trim();
      author = authorMatch[2].trim();
    }

    // 2. Identify the Metadata line
    // It usually contains dates and location info.
    // Keywords: "Added on", "添加于", "位置", "Location"
    let metadataIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].includes('|') || lines[i].includes('Added on') || lines[i].includes('添加于')) {
        metadataIndex = i;
        break;
      }
    }

    // If we couldn't find a metadata line, we might be parsing it wrong or it's a malformed entry.
    // Fallback: Assume 2nd line is metadata if not found (standard format)
    if (metadataIndex === -1) metadataIndex = 1;

    const metadataLine = lines[metadataIndex];
    let location = '';
    let dateAdded = '';

    const parts = metadataLine.split('|');
    if (parts.length >= 1) {
      // Extract location: "您在位置 #1203-1205的标注" -> "#1203-1205"
      // Or "- Your Highlight on Location 123-125"
      location = parts[0].trim();
    }
    if (parts.length >= 2) {
      dateAdded = parts[1].replace('Added on', '').replace('添加于', '').trim();
    }

    // 3. Extract Content
    // Content is everything after the metadata line
    const contentLines = lines.slice(metadataIndex + 1);
    const content = contentLines.join('\n').trim();

    // 3. Parse Date for Sorting
    let timestamp = 0;
    try {
      // Clean up the date string
      // Chinese: "2026年3月1日星期日 下午3:15:20"
      // English: "Saturday, August 12, 2023 10:00:00 AM"
      
      let dateStr = dateAdded.trim();
      
      // Attempt to parse Chinese format manually because Date.parse doesn't handle "2026年..." well
      // Regex for Chinese: (\d+)年(\d+)月(\d+)日.*(上午|下午|晚上)(\d+):(\d+):(\d+)
      const cnMatch = dateStr.match(/(\d+)年(\d+)月(\d+)日.*(上午|下午|晚上)(\d+):(\d+):(\d+)/);
      
      if (cnMatch) {
        const year = parseInt(cnMatch[1]);
        const month = parseInt(cnMatch[2]) - 1; // Months are 0-indexed
        const day = parseInt(cnMatch[3]);
        const period = cnMatch[4];
        let hour = parseInt(cnMatch[5]);
        const minute = parseInt(cnMatch[6]);
        const second = parseInt(cnMatch[7]);

        if (period === '下午' || period === '晚上') {
          if (hour < 12) hour += 12;
        } else if (period === '上午') {
          if (hour === 12) hour = 0;
        }

        timestamp = new Date(year, month, day, hour, minute, second).getTime();
      } else {
        // Try standard English parsing
        // Remove day of week if present (e.g., "Saturday, ") to help Date.parse
        // Format: "August 12, 2023 10:00:00 AM" works with Date.parse usually
        // But "Saturday, August 12..." might need cleaning
        const cleanedDate = dateStr.replace(/^[A-Za-z]+,\s+/, ''); 
        timestamp = Date.parse(cleanedDate);
        
        if (isNaN(timestamp)) {
           // Fallback: try parsing the original string directly
           timestamp = Date.parse(dateStr);
        }
      }
      
      if (isNaN(timestamp)) timestamp = 0;
      
    } catch (e) {
      console.error('Date parsing failed', e);
      timestamp = 0;
    }

    // Only add if we have content (or at least a title)
    if (bookTitle) {
      clippings.push({
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2),
        bookTitle,
        author,
        location,
        dateAdded,
        rawDate: dateAdded, 
        timestamp,
        content,
        comment: '',
      });
    }
  });

  return clippings;
}
