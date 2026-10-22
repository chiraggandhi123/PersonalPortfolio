import React from "react";
import { Container } from "react-bootstrap";
import Particle from "../Particle";
import "../../style.css";

function Blogs() {
  return (
    <Container fluid className="project-section">
      <Particle />
      <Container>
        <h1 className="project-heading">
          My <strong className="purple">Blogs </strong>
        </h1>
        <p style={{ color: "white" }}>Coming soon.</p>
      </Container>
    </Container>
  );
}

export default Blogs;
