import { S3Client } from '@aws-sdk/client-s3';
import multer from 'multer';
import multerS3 from 'multer-s3';
import { env } from '../config/env.js';

const s3Config = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  }
});

export const uploadToS3 = multer({
  storage: multerS3({
    s3: s3Config,
    bucket: env.AWS_S3_BUCKET_NAME,
    // ACL omitted: S3 buckets with "Bucket owner enforced" disable ACLs; use bucket policy for public read
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      const isArtist = req.path?.includes('/artists/') || req.path?.includes('/upload-artist-');
      const ext = (file.originalname || '').split('.').pop() || 'jpg';
      let folder;
      if (file.fieldname === 'aadharCard') {
        folder = 'ArtistsData/AadharCards';
      } else if (file.fieldname === 'panCard') {
        folder = 'ArtistsData/PanCards';
      } else if (file.fieldname === 'screenshot') {
        folder = 'Payments/Screenshots';
      } else if (file.fieldname === 'profilePhoto') {
        folder = isArtist ? 'ArtistsData/ProfilePictures' : 'UsersData/ProfilePictures';
      } else {
        folder = 'uploads';
      }
      cb(null, `${folder}/${file.fieldname}-${Date.now()}.${ext}`);
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB max file size
  }
});

export const uploadSingle = (fieldName) => uploadToS3.single(fieldName);

export const uploadFields = (fields) => uploadToS3.fields(fields);
