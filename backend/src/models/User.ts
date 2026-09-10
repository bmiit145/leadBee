import mongoose, { Schema, type Document, type Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES, type Role } from '../config/constants.js';
import { tenantPlugin } from '../lib/tenantPlugin.js';
import { tenantJsonTransform } from '../lib/toJSON.js';

/** A person inside one organization. Platform admins are a separate realm. */
export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  name: string;
  email?: string;
  phone: string;
  password: string;
  role: Role;
  roleId?: mongoose.Types.ObjectId;
  permissions: string[];
  projects: mongoose.Types.ObjectId[];
  defaultProject?: mongoose.Types.ObjectId;
  avatarUrl?: string;
  designation?: string;
  isActive: boolean;
  refreshTokens: string[];
  lastLoginAt?: Date;
  pushToken?: string;
  locale: string;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      set: (value: string | null | undefined) => {
        if (value === null || value === undefined) return undefined;
        const normalized = value.trim().toLowerCase();
        return normalized === '' ? undefined : normalized;
      },
    },
    /** Phone values are canonicalized by every application write boundary. */
    phone: { type: String, required: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.USER },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role' },
    permissions: { type: [String], default: [] },
    projects: { type: [{ type: Schema.Types.ObjectId, ref: 'Project' }], default: [] },
    defaultProject: { type: Schema.Types.ObjectId, ref: 'Project' },
    avatarUrl: { type: String, trim: true },
    designation: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    refreshTokens: { type: [String], default: [], select: false },
    lastLoginAt: { type: Date },
    pushToken: { type: String, trim: true, select: false },
    locale: { type: String, default: 'en' },
  },
  { timestamps: true }
);

userSchema.plugin(tenantPlugin);
userSchema.index({ organizationId: 1, phone: 1 }, { unique: true });
userSchema.index({ organizationId: 1, email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ organizationId: 1, isActive: 1, role: 1 });
userSchema.index({ organizationId: 1, name: 1 });

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = function (this: IUser, candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

userSchema.set('toJSON', {
  virtuals: true,
  transform: tenantJsonTransform('password', 'refreshTokens', 'pushToken'),
});

export const User: Model<IUser> = mongoose.model<IUser>('User', userSchema);
