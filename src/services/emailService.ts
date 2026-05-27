import nodemailer from 'nodemailer';
import { getEmailConfig } from '../config/runtimeConfig.js';

export async function sendOtpEmail(to: string, otp: string, otpExpiryMinutes: number): Promise<void> {
    const { gmailEmail, gmailPassword } = getEmailConfig();
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: gmailEmail,
            pass: gmailPassword
        },
    });

    const mailOptions = {
        from: gmailEmail,
        to,
        subject: 'Your Password Reset OTP',
        text: `Your OTP is: ${otp}\nThis code will expire in ${otpExpiryMinutes} minutes.`,
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Password Reset Request</h2>
          <p>Your OTP code is:</p>
          <div style="background: #f4f4f4; padding: 10px; margin: 10px 0; font-size: 24px; letter-spacing: 2px;">
            <strong>${otp}</strong>
          </div>
          <p>This code will expire in ${otpExpiryMinutes} minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
}
