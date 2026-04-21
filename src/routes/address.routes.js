import { Router } from 'express';
import {
  createAddress,
  deleteAddress,
  listUserAddresses,
  updateAddress,
} from '../controllers/address.controller.js';
import { authorizeRoles, verifyJWT } from '../middleware/auth.middleware.js';

const router = Router();

router.use(verifyJWT, authorizeRoles('USER'));

router.route('/').get(listUserAddresses).post(createAddress);
router.route('/:id').patch(updateAddress).delete(deleteAddress);

export default router;
