-- Agent page/crop renders are JPEG; preserve every existing bucket media type.
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'image/jpeg')
where id = 'paper-files' and allowed_mime_types is not null
  and not ('image/jpeg' = any(allowed_mime_types));
