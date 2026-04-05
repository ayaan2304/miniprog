import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import { hasExpired } from "../utils/dateUtils.js";

const getAccessMeta = (enrollment) => {
  if (!enrollment) {
    return { fullAccess: false, trialActive: false, paidActive: false, trialDaysLeft: 0 };
  }

  const trialActive = enrollment.trialEndDate ? !hasExpired(enrollment.trialEndDate) : false;
  const paidActive = enrollment.paymentStatus === "SUCCESS" && enrollment.expiryDate ? !hasExpired(enrollment.expiryDate) : false;

  const trialDaysLeft = trialActive
    ? Math.max(0, Math.ceil((new Date(enrollment.trialEndDate) - new Date()) / (1000 * 60 * 60 * 24)))
    : 0;

  return { fullAccess: trialActive || paidActive, trialActive, paidActive, trialDaysLeft };
};

export const getCourses = async (_req, res) => {
  const courses = await Course.find().sort({ createdAt: -1 });
  res.json(courses);
};

export const getCourseById = async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) return res.status(404).json({ message: "Course not found" });

  const userId = req.user?.id;
  const enrollment = userId ? await Enrollment.findOne({ userId, courseId: course._id }) : null;
  // Cross-course lock: if user has active access to any different course, lock this one
  let otherActive = null;
  if (userId) {
    const others = await Enrollment.find({ userId, courseId: { $ne: course._id } });
    otherActive = others.find((e) => {
      const trialActive = e.trialEndDate && new Date() <= new Date(e.trialEndDate);
      const paidActive = e.paymentStatus === "SUCCESS" && e.expiryDate && new Date() <= new Date(e.expiryDate);
      return trialActive || paidActive;
    });
  }

  const access = getAccessMeta(enrollment);
  const lockedByOtherCourse = Boolean(otherActive);

  const videos = course.videos.map((video, index) => {
    const freeByIndex = index < 2;
    const unlocked = (freeByIndex || video.isFreePreview || access.fullAccess) && !lockedByOtherCourse;
    return {
      ...video.toObject(),
      unlocked,
      lockedReason: unlocked ? "" : lockedByOtherCourse
        ? "You already have an active course. Finish or expire it to access others."
        : "Locked after trial. Buy course to continue.",
    };
  });

  res.json({ ...course.toObject(), videos, access, lockedByOtherCourse });
};

export const createCourse = async (req, res) => {
  const course = await Course.create(req.body);
  res.status(201).json(course);
};
