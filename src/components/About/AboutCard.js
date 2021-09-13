import React from "react";
import Card from "react-bootstrap/Card";
import "../../style.css";
import "bootstrap/dist/css/bootstrap.min.css";

function AboutCard() {
  return (
    <Card className="quote-card-view">
      <Card.Body>
        <blockquote className="blockquote mb-0">
          <p style={{ textAlign: "justify" }}>
            Hi Everyone, I am <span className="purple">Chirag Gandhi </span>
            from Faridabad, India.
            <br />I have completed my <span className="purple">bachelors</span> from <span className="purple">BVCOE, New Delhi</span> in <span className="purple">Information Technology.</span>
            <br />
            I am working full-time as a <span className="purple">MERN developer at TO THE NEW.</span>
            <br />
            Apart from coding, some other activities that I love to do!
          </p>
          <ul>
            <li className="about-activity">
              <i className="far fa-hand-point-right"></i> Playing Cricket
            </li>
            <li className="about-activity">
              <i className="far fa-hand-point-right"></i> Jamming a Guitar
            </li>
            <li className="about-activity">
              <i className="far fa-hand-point-right"></i> Travelling
            </li>
          </ul>
{/* 
          <p style={{ marginBlockEnd: 0, color: "rgb(155 126 172)" }}>
            "Strive to build things that make a difference!"{" "}
          </p>
          <footer className="blockquote-footer">Soumyajit</footer> */}
        </blockquote>
      </Card.Body>
    </Card>
  );
}

export default AboutCard;
